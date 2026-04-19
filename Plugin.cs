using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Text.Json;
using System.Threading;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Model.Plugins;
using Microsoft.Extensions.Logging;
using Jellyfin.Data.Enums;

namespace Jellyfeatured;

/// <summary>
/// The main plugin class.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages, IDisposable
{
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<Plugin> _logger;
    private readonly string _recommendationsPath;
    private readonly IApplicationPaths _applicationPaths;
    private Timer? _refreshTimer;
    private bool _disposed = false;

    public static Plugin? Instance { get; private set; }

    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Instance of the <see cref="IApplicationPaths"/> interface.</param>
    /// <param name="xmlSerializer">Instance of the <see cref="IXmlSerializer"/> interface.</param>
    /// <param name="libraryManager">Instance of the <see cref="ILibraryManager"/> interface.</param>
    /// <param name="logger">Instance of the <see cref="ILogger{Plugin}"/> interface.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer, ILibraryManager libraryManager, ILogger<Plugin> logger)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        _libraryManager = libraryManager;
        _logger = logger;
        _applicationPaths = applicationPaths;
        _recommendationsPath = Path.Combine(applicationPaths.DataPath, "jellyfeatured-recommendations.json");

        try
        {
            EnsureConfigurationDefaults();
            
            _ = Task.Run(async () => await InitializePluginAsync(applicationPaths));
            StartRefreshTimer(applicationPaths);
            ConfigurationChanged += OnConfigurationChanged;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize Jellyfeatured plugin safely");
        }
    }
    
    private void OnConfigurationChanged(object? sender, BasePluginConfiguration e)
    {
        var config = (PluginConfiguration)e;
        _logger.LogInformation("🔧 Configuration change detected! Refresh interval: {Hours}h, Admin picks enabled: {Enabled}, Manual refresh timestamp: {ManualRefresh}", 
            config.RefreshIntervalHours, config.EnableAdminPicks, config.LastManualRefresh);

        if (ValidateConfiguration(config))
        {
            _logger.LogInformation("Configuration validation passed - triggering immediate refresh");

            _ = Task.Run(async () => await RefreshRecommendationsAsync(_applicationPaths));

            _refreshTimer?.Dispose();
            StartRefreshTimer(_applicationPaths);
            
            _logger.LogInformation("Refresh task started and timer restarted with {Hours}h interval", config.RefreshIntervalHours);
        }
        else
        {
            _logger.LogError("Invalid configuration detected, keeping previous settings");
        }
    }
    
    private bool ValidateConfiguration(PluginConfiguration config)
    {
        if (config == null)
        {
            _logger.LogError("Configuration is null");
            return false;
        }
        
        if (config.RefreshIntervalHours <= 0 || config.RefreshIntervalHours > 8760)
        {
            _logger.LogError("RefreshIntervalHours is invalid: {Hours}", config.RefreshIntervalHours);
            return false;
        }

        _logger.LogInformation("Configuration validation passed - using settings: {Settings}", 
            System.Text.Json.JsonSerializer.Serialize(config, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        
        return true;
    }
    
    private void EnsureConfigurationDefaults()
    {
        try
        {
            var config = Configuration;
            bool configChanged = false;
            
            _logger.LogInformation("Checking configuration defaults...");

            if (config.RefreshIntervalHours <= 0)
            {
                config.RefreshIntervalHours = 24;
                configChanged = true;
                _logger.LogInformation("Set default RefreshIntervalHours to 24");
            }

            if (config.AdminPickIds == null)
            {
                config.AdminPickIds = new List<string>();
                configChanged = true;
                _logger.LogInformation("Set default empty AdminPickIds");
            }
            
            if (configChanged)
            {
                SaveConfiguration();
                _logger.LogInformation("Configuration defaults saved successfully");
            }
            else
            {
                _logger.LogInformation("Configuration already has valid defaults");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to ensure configuration defaults");
        }
    }
    
    private async Task RefreshRecommendationsAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            _logger.LogInformation("Starting recommendations refresh...");
            var recommendations = await GenerateRecommendationsAsync();
            _logger.LogInformation("Generated {Count} recommendations", recommendations.Count);
            
            await SaveRecommendationsAsync(recommendations);
            _logger.LogInformation("Saved recommendations to {Path}", _recommendationsPath);
            
            _logger.LogInformation("Recommendations refresh completed successfully!");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to refresh recommendations");
        }
    }

    /// <summary>
    /// Public trigger to refresh recommendations on demand (called by controller).
    /// </summary>
    public async Task TriggerRefresh()
    {
        try
        {
            await RefreshRecommendationsAsync(_applicationPaths);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "TriggerRefresh failed");
        }
    }

    private async Task InitializePluginAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            _logger.LogInformation("Initializing Jellyfeatured plugin...");

            var config = Configuration;
            _logger.LogInformation("Initial configuration: RefreshInterval={Hours}h, AdminPicks={AdminPicks}", 
                config.RefreshIntervalHours, config.EnableAdminPicks);
            
            var recommendations = await GenerateRecommendationsAsync();

            await SaveRecommendationsAsync(recommendations);
            
            _logger.LogInformation("Jellyfeatured plugin initialization completed successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Jellyfeatured plugin initialization failed");
        }
    }
    
    private bool HasRequiredImages(BaseItem item)
    {
        if (item == null) return false;
        
        bool hasPoster = item.HasImage(MediaBrowser.Model.Entities.ImageType.Primary);
        bool hasBackdrop = item.HasImage(MediaBrowser.Model.Entities.ImageType.Backdrop);
        
        if (!hasPoster || !hasBackdrop)
        {
            _logger.LogDebug("Item '{Title}' excluded: Poster={HasPoster}, Backdrop={HasBackdrop}", 
                item.Name, hasPoster, hasBackdrop);
        }
        
        return hasPoster && hasBackdrop;
    }
    private async Task<List<RecommendationItem>> GenerateRecommendationsAsync()
    {
        var recommendations = new List<RecommendationItem>();
        var categoryItems = new Dictionary<string, RecommendationItem>();
        
        var config = Configuration;
        
        _logger.LogInformation("Current configuration being used: RefreshInterval={Hours}h, AdminPicksEnabled={AdminPicks}, AdminPickIds=[{AdminIds}]", 
            config.RefreshIntervalHours, config.EnableAdminPicks, string.Join(", ", config.AdminPickIds));

        var fixedCategoryOrder = new List<string>
        {
            "featuredPick",
            "latestRelease", 
            "recentlyAddedFilms",
            "recentlyAddedSeries",
            "bestRatedFilms",
            "bestRatedSeries"
        };
        
        var categoryMapping = new Dictionary<string, string>
        {
            { "featuredPick", "Admin's Pick" },
            { "latestRelease", "Latest Release" },
            { "recentlyAddedFilms", "Recently Added in Films" },
            { "recentlyAddedSeries", "Recently Added in Series" },
            { "bestRatedFilms", "Best Rated in Films" },
            { "bestRatedSeries", "Best Rated in Series" }
        };
        
        try
        {
            var allItems = _libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Series },
                IsVirtualItem = false
            }).ToList();
            
            if (allItems == null || allItems.Count == 0)
            {
                _logger.LogWarning("No media items found in library");
                return recommendations;
            }
            
            await Task.Delay(1);

            var latestMovie = allItems
                .OfType<Movie>()
                .Where(m => m.PremiereDate.HasValue)
                .OrderByDescending(m => m.PremiereDate)
                .FirstOrDefault(m => HasRequiredImages(m));
                
            if (latestMovie != null)
            {
                categoryItems["latestRelease"] = new RecommendationItem
                {
                    Title = latestMovie.Name,
                    Id = latestMovie.Id.ToString(),
                    Type = "Latest Release",
                    Year = latestMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = latestMovie.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }

            var recentAddedMovie = allItems
                .OfType<Movie>()
                .OrderByDescending(m => m.DateCreated)
                .FirstOrDefault(m => HasRequiredImages(m));
                
            if (recentAddedMovie != null)
            {
                categoryItems["recentlyAddedFilms"] = new RecommendationItem
                {
                    Title = recentAddedMovie.Name,
                    Id = recentAddedMovie.Id.ToString(),
                    Type = "Recently Added in Films",
                    Year = recentAddedMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = recentAddedMovie.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            var recentAddedShow = allItems
                .OfType<Series>()
                .OrderByDescending(s => s.DateCreated)
                .FirstOrDefault(s => HasRequiredImages(s));
                
            if (recentAddedShow != null)
            {
                categoryItems["recentlyAddedSeries"] = new RecommendationItem
                {
                    Title = recentAddedShow.Name,
                    Id = recentAddedShow.Id.ToString(),
                    Type = "Recently Added in Series",
                    Year = recentAddedShow.PremiereDate?.Year.ToString() ?? "",
                    Rating = recentAddedShow.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            var bestMovie = allItems
                .OfType<Movie>()
                .Where(m => m.CommunityRating.HasValue && m.CommunityRating > 0 && m.CommunityRating < 10.0)
                .OrderByDescending(m => m.CommunityRating)
                .FirstOrDefault(m => HasRequiredImages(m));
                
            if (bestMovie != null)
            {
                categoryItems["bestRatedFilms"] = new RecommendationItem
                {
                    Title = bestMovie.Name,
                    Id = bestMovie.Id.ToString(),
                    Type = "Best Rated in Films",
                    Year = bestMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = bestMovie.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            var bestShow = allItems
                .OfType<Series>()
                .Where(s => s.CommunityRating.HasValue && s.CommunityRating > 0 && s.CommunityRating < 10.0)
                .OrderByDescending(s => s.CommunityRating)
                .FirstOrDefault(s => HasRequiredImages(s));
                
            if (bestShow != null)
            {
                categoryItems["bestRatedSeries"] = new RecommendationItem
                {
                    Title = bestShow.Name,
                    Id = bestShow.Id.ToString(),
                    Type = "Best Rated in Series",
                    Year = bestShow.PremiereDate?.Year.ToString() ?? "",
                    Rating = bestShow.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            _logger.LogInformation("Admin picks check - EnableAdminPicks: {Enabled}, AdminPickIds count: {Count}", 
                config.EnableAdminPicks, config.AdminPickIds?.Count ?? 0);
                
            if (config.EnableAdminPicks && config.AdminPickIds?.Count > 0)
            {
                var adminPickItems = new List<RecommendationItem>();
                
                foreach (var itemId in config.AdminPickIds)
                {
                    try
                    {
                        _logger.LogInformation("Processing admin pick item ID: {ItemId}", itemId);
                        if (Guid.TryParse(itemId, out var guid))
                        {
                            var item = _libraryManager.GetItemById(guid);
                            if (item != null && HasRequiredImages(item))
                            {
                                _logger.LogInformation("Found admin pick item: {Name}", item.Name);
                                adminPickItems.Add(new RecommendationItem
                                {
                                    Title = item.Name,
                                        Id = item.Id.ToString(),
                                    Type = "Admin's Pick",
                                    Year = item.PremiereDate?.Year.ToString() ?? "",
                                    Rating = item.CommunityRating?.ToString("F1") ?? "N/A"
                                });
                            }
                            else if (item != null)
                            {
                                _logger.LogWarning("Admin pick item '{Name}' excluded - missing poster or backdrop", item.Name);
                            }
                            else
                            {
                                _logger.LogWarning("Admin pick item not found for ID: {ItemId}", itemId);
                            }
                        }
                        else
                        {
                            _logger.LogWarning("Invalid GUID format for admin pick ID: {ItemId}", itemId);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to load admin pick item with ID: {ItemId}", itemId);
                    }
                }

                if (adminPickItems.Count > 0)
                {
                    categoryItems["featuredPick"] = adminPickItems.First();
                    _logger.LogInformation("Added {Count} admin pick items to featuredPick category", adminPickItems.Count);
                }
                else
                {
                    _logger.LogWarning("No valid admin pick items found despite having AdminPickIds configured");
                }
            }

            foreach (var categoryVariable in fixedCategoryOrder)
            {
                if (categoryVariable == "featuredPick" && (!config.EnableAdminPicks || !categoryItems.ContainsKey("featuredPick")))
                {
                    continue;
                }
                
                if (categoryItems.ContainsKey(categoryVariable))
                {
                    recommendations.Add(categoryItems[categoryVariable]);
                    _logger.LogInformation("Added category '{Category}' to recommendations: {Title}", 
                        categoryVariable, categoryItems[categoryVariable].Title);
                }
                else
                {
                    _logger.LogWarning("Category '{Category}' not found in available categories", categoryVariable);
                }
            }
            
            _logger.LogInformation("Generated {Count} total recommendations", recommendations.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate recommendations");
        }
        
        return recommendations;
    }
    
    private async Task SaveRecommendationsAsync(List<RecommendationItem> recommendations)
    {
        try
        {
            var json = JsonSerializer.Serialize(recommendations, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(_recommendationsPath, json);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save recommendations");
        }
    }
    
    /// <summary>
    /// Builds the carousel inject script from embedded resources and the saved
    /// recommendations JSON.  Called by the GET /Plugins/Jellyfeatured/Script
    /// controller endpoint so no files need to be written to the web directory.
    /// </summary>
    public async Task<string> GetInjectScriptAsync()
    {
        try
        {
            List<RecommendationItem> recommendations;

            if (File.Exists(_recommendationsPath))
            {
                var json = await File.ReadAllTextAsync(_recommendationsPath);
                recommendations = JsonSerializer.Deserialize<List<RecommendationItem>>(
                    json,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                ) ?? new List<RecommendationItem>();
            }
            else
            {
                recommendations = new List<RecommendationItem>();
            }

            var assembly = Assembly.GetExecutingAssembly();
            var htmlInject = await LoadEmbeddedResourceAsync(assembly, "Jellyfeatured.main.html");
            var jsInject   = await LoadEmbeddedResourceAsync(assembly, "Jellyfeatured.main.js");
            var cssInject  = await LoadEmbeddedResourceAsync(assembly, "Jellyfeatured.main.css");

            var recommendationsJson = JsonSerializer.Serialize(
                recommendations,
                new JsonSerializerOptions { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase }
            );

            var autoSlideMs = (Configuration.AutoSlideIntervalSeconds > 0
                ? Configuration.AutoSlideIntervalSeconds
                : 6) * 1000;

            var processedHtml = htmlInject.Replace("{{CSS_STYLES}}", cssInject);
            return jsInject
                .Replace("{{RECOMMENDATIONS_DATA_JSON}}", recommendationsJson)
                .Replace("{{AUTO_SLIDE_INTERVAL_MS}}", autoSlideMs.ToString())
                .Replace("{{HTML_TEMPLATE}}", EscapeJs(processedHtml));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetInjectScriptAsync failed");
            return string.Empty;
        }
    }
    
    private async Task<string> LoadEmbeddedResourceAsync(Assembly assembly, string resourceName)
    {
        using (var stream = assembly.GetManifestResourceStream(resourceName))
        {
            if (stream != null)
            {
                using (var reader = new StreamReader(stream))
                {
                    return await reader.ReadToEndAsync();
                }
            }
            else
            {
                return "";
            }
        }
    }
    
    private string EscapeJs(string input)
    {
        if (string.IsNullOrEmpty(input)) return "";
        return input.Replace("'", "\\'").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r");
    }
    
    private void StartRefreshTimer(IApplicationPaths applicationPaths)
    {
        try
        {
            var refreshInterval = TimeSpan.FromHours(Configuration.RefreshIntervalHours);
            
            _refreshTimer = new Timer(async _ => await RefreshRecommendations(applicationPaths), 
                null, refreshInterval, refreshInterval);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start refresh timer");
        }
    }
    
    private async Task RefreshRecommendations(IApplicationPaths applicationPaths)
    {
        try
        {
            var recommendations = await GenerateRecommendationsAsync();
            await SaveRecommendationsAsync(recommendations);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Periodic refresh failed");
        }
    }
    
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }
    
    protected virtual void Dispose(bool disposing)
    {
        if (!_disposed)
        {
            if (disposing)
            {
                _refreshTimer?.Dispose();
            }
            _disposed = true;
        }
    }

    /// <inheritdoc />
    public override string Name => "Jellyfeatured";

    /// <inheritdoc />
    public override string Description => "Get recommendations on your home page";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("639b5171-918b-4b24-82e4-d35c10be63a4");

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
    {
        return new[]
        {
            new PluginPageInfo
            {
                Name = "Jellyfeatured",
                EmbeddedResourcePath = string.Format("{0}.Configuration.dashboardPage.html", GetType().Namespace),
                EnableInMainMenu = true
            }
        };
    }
}

public class RecommendationItem
{
    public string Title { get; set; } = "";
    public string Type { get; set; } = "";
    public string Year { get; set; } = "";
    public string Rating { get; set; } = "";
    public string Id { get; set; } = "";
}