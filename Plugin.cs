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
        
        // Safer initialization with error handling
        try
        {
            // Ensure configuration is properly initialized with defaults
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
        _logger.LogInformation("🔧 Configuration change detected! Category order: [{Categories}], Refresh interval: {Hours}h, Admin picks enabled: {Enabled}, Manual refresh timestamp: {ManualRefresh}", 
            string.Join(", ", config.CategoryOrder), config.RefreshIntervalHours, config.EnableAdminPicks, config.LastManualRefresh);

        // Validate configuration before processing
        if (ValidateConfiguration(config))
        {
            _logger.LogInformation("✅ Configuration validation passed - triggering immediate refresh");
            
            // Always refresh recommendations when configuration changes
            // This handles both category order changes and manual refresh requests
            _ = Task.Run(async () => await RefreshRecommendationsAsync(_applicationPaths));
            
            // Restart the timer with the new interval
            _refreshTimer?.Dispose();
            StartRefreshTimer(_applicationPaths);
            
            _logger.LogInformation("🔄 Refresh task started and timer restarted with {Hours}h interval", config.RefreshIntervalHours);
        }
        else
        {
            _logger.LogError("❌ Invalid configuration detected, keeping previous settings");
        }
    }
    
    private bool ValidateConfiguration(PluginConfiguration config)
    {
        if (config == null)
        {
            _logger.LogError("Configuration is null");
            return false;
        }
        
        if (config.CategoryOrder == null || config.CategoryOrder.Count == 0)
        {
            _logger.LogError("CategoryOrder is null or empty");
            return false;
        }
        
        if (config.RefreshIntervalHours <= 0 || config.RefreshIntervalHours > 8760) // Max 1 year
        {
            _logger.LogError("RefreshIntervalHours is invalid: {Hours}", config.RefreshIntervalHours);
            return false;
        }
        
        // Log current configuration for debugging
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
            
            _logger.LogInformation("🔍 Checking configuration defaults...");
            
            // Ensure CategoryOrder exists and has defaults
            if (config.CategoryOrder == null || config.CategoryOrder.Count == 0)
            {
                config.CategoryOrder = new List<string>
                {
                    "latestRelease",
                    "recentlyAddedFilms",
                    "recentlyAddedSeries",
                    "bestRatedFilms",
                    "bestRatedSeries"
                };
                configChanged = true;
                _logger.LogInformation("✅ Set default CategoryOrder");
            }
            
            // Ensure RefreshIntervalHours has a valid default
            if (config.RefreshIntervalHours <= 0)
            {
                config.RefreshIntervalHours = 24;
                configChanged = true;
                _logger.LogInformation("✅ Set default RefreshIntervalHours to 24");
            }
            
            // Ensure AdminPickIds exists
            if (config.AdminPickIds == null)
            {
                config.AdminPickIds = new List<string>();
                configChanged = true;
                _logger.LogInformation("✅ Set default empty AdminPickIds");
            }
            
            if (configChanged)
            {
                SaveConfiguration();
                _logger.LogInformation("💾 Configuration defaults saved successfully");
            }
            else
            {
                _logger.LogInformation("✅ Configuration already has valid defaults");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to ensure configuration defaults");
        }
    }
    
    private async Task RefreshRecommendationsAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            _logger.LogInformation("🚀 Starting recommendations refresh...");
            var recommendations = await GenerateRecommendationsAsync();
            _logger.LogInformation("📊 Generated {Count} recommendations", recommendations.Count);
            
            await SaveRecommendationsAsync(recommendations);
            _logger.LogInformation("💾 Saved recommendations to {Path}", _recommendationsPath);
            
            await CreateWebScriptAsync(applicationPaths, recommendations);
            _logger.LogInformation("🎨 Created web script for recommendations");
            
            await InjectIntoIndexHtmlAsync(applicationPaths);
            _logger.LogInformation("🏠 Injected recommendations into home page");
            
            _logger.LogInformation("✅ Recommendations refresh completed successfully!");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to refresh recommendations");
        }
    }

    private async Task InitializePluginAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            _logger.LogInformation("🎯 Initializing Jellyfeatured plugin...");
            
            // Log current configuration being used for initialization
            var config = Configuration;
            _logger.LogInformation("📋 Initial configuration: Categories=[{Categories}], RefreshInterval={Hours}h, AdminPicks={AdminPicks}", 
                string.Join(", ", config.CategoryOrder), config.RefreshIntervalHours, config.EnableAdminPicks);
            
            var recommendations = await GenerateRecommendationsAsync();

            await SaveRecommendationsAsync(recommendations);
            await CreateWebScriptAsync(applicationPaths, recommendations);
            await InjectIntoIndexHtmlAsync(applicationPaths);
            
            _logger.LogInformation("✅ Jellyfeatured plugin initialization completed successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Jellyfeatured plugin initialization failed");
        }
    }
    private async Task<List<RecommendationItem>> GenerateRecommendationsAsync()
    {
        var recommendations = new List<RecommendationItem>();
        var categoryItems = new Dictionary<string, RecommendationItem>();
        
        // Use standard Jellyfin configuration
        var config = Configuration;
        
        _logger.LogInformation("📋 Current configuration being used: Categories=[{Categories}], RefreshInterval={Hours}h, AdminPicksEnabled={AdminPicks}, AdminPickIds=[{AdminIds}]", 
            string.Join(", ", config.CategoryOrder), config.RefreshIntervalHours, config.EnableAdminPicks, string.Join(", ", config.AdminPickIds));
        
        // Category variable mapping
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
            
            // Ensure we have items before proceeding
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
                .FirstOrDefault();
                
            if (latestMovie != null)
            {
                categoryItems["latestRelease"] = new RecommendationItem
                {
                    Title = latestMovie.Name,
                    Type = "Latest Release",
                    Year = latestMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = latestMovie.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }

            var recentAddedMovie = allItems
                .OfType<Movie>()
                .OrderByDescending(m => m.DateCreated)
                .FirstOrDefault();
                
            if (recentAddedMovie != null)
            {
                categoryItems["recentlyAddedFilms"] = new RecommendationItem
                {
                    Title = recentAddedMovie.Name,
                    Type = "Recently Added in Films",
                    Year = recentAddedMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = recentAddedMovie.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            var recentAddedShow = allItems
                .OfType<Series>()
                .OrderByDescending(s => s.DateCreated)
                .FirstOrDefault();
                
            if (recentAddedShow != null)
            {
                categoryItems["recentlyAddedSeries"] = new RecommendationItem
                {
                    Title = recentAddedShow.Name,
                    Type = "Recently Added in Series",
                    Year = recentAddedShow.PremiereDate?.Year.ToString() ?? "",
                    Rating = recentAddedShow.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            var bestMovie = allItems
                .OfType<Movie>()
                .Where(m => m.CommunityRating.HasValue && m.CommunityRating > 0 && m.CommunityRating < 10.0)
                .OrderByDescending(m => m.CommunityRating)
                .FirstOrDefault();
                
            if (bestMovie != null)
            {
                categoryItems["bestRatedFilms"] = new RecommendationItem
                {
                    Title = bestMovie.Name,
                    Type = "Best Rated in Films",
                    Year = bestMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = bestMovie.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            var bestShow = allItems
                .OfType<Series>()
                .Where(s => s.CommunityRating.HasValue && s.CommunityRating > 0 && s.CommunityRating < 10.0)
                .OrderByDescending(s => s.CommunityRating)
                .FirstOrDefault();
                
            if (bestShow != null)
            {
                categoryItems["bestRatedSeries"] = new RecommendationItem
                {
                    Title = bestShow.Name,
                    Type = "Best Rated in Series",
                    Year = bestShow.PremiereDate?.Year.ToString() ?? "",
                    Rating = bestShow.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            // Handle Admin's Picks (featuredPick) using standard configuration
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
                            if (item != null)
                            {
                                _logger.LogInformation("Found admin pick item: {Name}", item.Name);
                                adminPickItems.Add(new RecommendationItem
                                {
                                    Title = item.Name,
                                    Type = "Admin's Pick",
                                    Year = item.PremiereDate?.Year.ToString() ?? "",
                                    Rating = item.CommunityRating?.ToString("F1") ?? "N/A"
                                });
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
                
                // If we have admin pick items, add them as a category
                if (adminPickItems.Count > 0)
                {
                    categoryItems["featuredPick"] = adminPickItems.First();
                    _logger.LogInformation("Added {Count} admin pick items to featuredPick category", adminPickItems.Count);
                    
                    // Ensure "featuredPick" is in CategoryOrder if it's not already there
                    if (!config.CategoryOrder.Contains("featuredPick"))
                    {
                        config.CategoryOrder.Insert(0, "featuredPick");
                        _logger.LogInformation("Added featuredPick to CategoryOrder");
                        // Save the updated configuration using Jellyfin's system
                        SaveConfiguration();
                    }
                }
                else
                {
                    _logger.LogWarning("No valid admin pick items found despite having AdminPickIds configured");
                }
            }
            else
            {
                if (config.CategoryOrder.Contains("featuredPick"))
                {
                    _logger.LogInformation("Admin picks disabled but featuredPick in CategoryOrder - this may result in missing category");
                }
                
                // Remove "featuredPick" from CategoryOrder if admin picks are disabled
                if (config.CategoryOrder.RemoveAll(c => c == "featuredPick") > 0)
                {
                    _logger.LogInformation("Removed featuredPick from CategoryOrder due to disabled admin picks");
                    // Save the updated configuration using Jellyfin's system
                    SaveConfiguration();
                }
            }
            
            foreach (var categoryVariable in config.CategoryOrder)
            {
                if (categoryItems.ContainsKey(categoryVariable))
                {
                    recommendations.Add(categoryItems[categoryVariable]);
                    _logger.LogInformation("Added category '{Category}' to recommendations: {Title}", 
                        categoryVariable, categoryItems[categoryVariable].Title);
                }
                else
                {
                    _logger.LogWarning("Category '{Category}' in CategoryOrder but no recommendation item found for it", categoryVariable);
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
    
    private async Task CreateWebScriptAsync(IApplicationPaths applicationPaths, List<RecommendationItem> recommendations)
    {
        try
        {
            var webPath = Path.Combine(applicationPaths.WebPath, "jellyfeatured-inject.js");
            var assembly = Assembly.GetExecutingAssembly();

            var htmlInject = await LoadEmbeddedResourceAsync(assembly, "Jellyfeatured.main.html");
            var jsInject = await LoadEmbeddedResourceAsync(assembly, "Jellyfeatured.main.js");
            var cssInject = await LoadEmbeddedResourceAsync(assembly, "Jellyfeatured.main.css");

            var recommendationsJs = string.Join(",\n        ", recommendations.Select(r => 
                $"{{ title: '{EscapeJs(r.Title)}', type: '{EscapeJs(r.Type)}', year: '{EscapeJs(r.Year)}', rating: '{EscapeJs(r.Rating)}' }}"));

            var processedHtml = htmlInject.Replace("{{CSS_STYLES}}", cssInject);
            var scriptContent = jsInject
                .Replace("{{RECOMMENDATIONS_DATA}}", recommendationsJs)
                .Replace("{{HTML_TEMPLATE}}", EscapeJs(processedHtml));
            
            await File.WriteAllTextAsync(webPath, scriptContent);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create web script");
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
    
    private async Task InjectIntoIndexHtmlAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            var indexPath = Path.Combine(applicationPaths.WebPath, "index.html");
            if (File.Exists(indexPath))
            {
                var indexContent = await File.ReadAllTextAsync(indexPath);
                var scriptTag = "<script src=\"/web/jellyfeatured-inject.js\"></script>";
                
                if (!indexContent.Contains("jellyfeatured-inject.js"))
                {
                    if (!indexContent.Contains("jellyfeatured-inject.js"))
                    {
                        indexContent = indexContent.Replace("</head>", scriptTag + "\n</head>");
                        await File.WriteAllTextAsync(indexPath, indexContent);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to inject web script");
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
            await CreateWebScriptAsync(applicationPaths, recommendations);
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
}