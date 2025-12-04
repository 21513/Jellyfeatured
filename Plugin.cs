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
    private readonly string _configPath;
    private readonly IApplicationPaths _applicationPaths;
    private Timer? _refreshTimer;
    private bool _disposed = false;
    private PluginConfiguration? _cachedConfig;

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
        _configPath = Path.Combine(applicationPaths.DataPath, "jellyfeatured-config.json");
        
        // Safer initialization with error handling
        try
        {
            _ = Task.Run(async () => await InitializePluginAsync(applicationPaths));
            StartRefreshTimer(applicationPaths);
            ConfigurationChanged += OnConfigurationChanged;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize Jellyfeatured plugin safely");
        }
    }
    
    // Direct JSON Configuration Management
    public async Task<PluginConfiguration> GetDirectConfigurationAsync()
    {
        try
        {
            if (!File.Exists(_configPath))
            {
                _logger.LogInformation("Direct configuration file not found, creating default at: {Path}", _configPath);
                var defaultConfig = new PluginConfiguration();
                await SaveDirectConfigurationAsync(defaultConfig);
                return defaultConfig;
            }

            var jsonContent = await File.ReadAllTextAsync(_configPath);
            var config = JsonSerializer.Deserialize<PluginConfiguration>(jsonContent);
            
            if (config == null)
            {
                _logger.LogWarning("Failed to deserialize direct configuration, using defaults");
                return new PluginConfiguration();
            }

            _cachedConfig = config;
            _logger.LogInformation("Direct configuration loaded successfully from: {Path}", _configPath);
            return config;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load direct configuration, using defaults");
            return new PluginConfiguration();
        }
    }

    public async Task SaveDirectConfigurationAsync(PluginConfiguration configuration)
    {
        try
        {
            var jsonString = JsonSerializer.Serialize(configuration, new JsonSerializerOptions 
            { 
                WriteIndented = true 
            });
            
            await File.WriteAllTextAsync(_configPath, jsonString);
            
            // Also update the web-accessible copy
            var webConfigPath = Path.Combine(_applicationPaths.WebPath, "jellyfeatured-config.json");
            await File.WriteAllTextAsync(webConfigPath, jsonString);
            
            _cachedConfig = configuration;
            _logger.LogInformation("Direct configuration saved successfully to: {Path} and {WebPath}", _configPath, webConfigPath);
            
            // Trigger refresh when configuration changes
            _ = Task.Run(async () => await RefreshRecommendationsAsync(_applicationPaths));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save direct configuration");
            throw;
        }
    }

    public async Task<string> GetConfigurationJsonAsync()
    {
        try
        {
            if (!File.Exists(_configPath))
            {
                var defaultConfig = new PluginConfiguration();
                await SaveDirectConfigurationAsync(defaultConfig);
            }

            return await File.ReadAllTextAsync(_configPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to read configuration JSON");
            var defaultConfig = new PluginConfiguration();
            var defaultJson = JsonSerializer.Serialize(defaultConfig, new JsonSerializerOptions { WriteIndented = true });
            return defaultJson;
        }
    }

    public async Task SaveConfigurationJsonAsync(string jsonContent)
    {
        try
        {
            // Validate JSON first
            var config = JsonSerializer.Deserialize<PluginConfiguration>(jsonContent);
            if (config == null)
            {
                throw new ArgumentException("Invalid JSON configuration");
            }

            await File.WriteAllTextAsync(_configPath, jsonContent);
            _cachedConfig = config;
            _logger.LogInformation("Configuration JSON saved successfully");
            
            // Trigger refresh when configuration changes
            _ = Task.Run(async () => await RefreshRecommendationsAsync(_applicationPaths));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save configuration JSON");
            throw;
        }
    }

    public async Task TriggerRefreshAsync()
    {
        await RefreshRecommendationsAsync(_applicationPaths);
    }

    public PluginConfiguration GetCurrentConfiguration()
    {
        return _cachedConfig ?? new PluginConfiguration();
    }
    
    private void OnConfigurationChanged(object? sender, BasePluginConfiguration e)
    {
        var config = (PluginConfiguration)e;
        _logger.LogInformation("Configuration changed detected - Category order: [{Categories}], Refresh interval: {Hours}h, Admin picks enabled: {Enabled}", 
            string.Join(", ", config.CategoryOrder), config.RefreshIntervalHours, config.EnableAdminPicks);

        // Validate configuration before processing
        if (ValidateConfiguration(config))
        {
            // Always refresh recommendations when configuration changes
            // This handles both category order changes and manual refresh requests
            _ = Task.Run(async () => await RefreshRecommendationsAsync(_applicationPaths));
            
            // Restart the timer with the new interval
            _refreshTimer?.Dispose();
            StartRefreshTimer(_applicationPaths);
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
    
    private async Task RefreshRecommendationsAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            _logger.LogInformation("Refreshing recommendations...");
            var recommendations = await GenerateRecommendationsAsync();
            await SaveRecommendationsAsync(recommendations);
            await CreateWebScriptAsync(applicationPaths, recommendations);
            await InjectIntoIndexHtmlAsync(applicationPaths);
            _logger.LogInformation("Recommendations refreshed successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to refresh recommendations");
        }
    }

    private async Task InitializePluginAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            // Generate example configuration file for user reference
            await CreateExampleConfigurationAsync(applicationPaths);
            
            // Copy configuration file to web directory for direct access
            await CreateWebConfigurationFileAsync(applicationPaths);
            
            var recommendations = await GenerateRecommendationsAsync();

            await SaveRecommendationsAsync(recommendations);
            await CreateWebScriptAsync(applicationPaths, recommendations);
            await InjectIntoIndexHtmlAsync(applicationPaths);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Jellyfeatured not started");
        }
    }
    private async Task<List<RecommendationItem>> GenerateRecommendationsAsync()
    {
        var recommendations = new List<RecommendationItem>();
        var categoryItems = new Dictionary<string, RecommendationItem>();
        
        // Get direct configuration instead of XML configuration
        var config = await GetDirectConfigurationAsync();
        
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
            
            // Handle Admin's Picks (featuredPick) using direct configuration
            if (config.EnableAdminPicks && config.AdminPickIds?.Count > 0)
            {
                var adminPickItems = new List<RecommendationItem>();
                
                foreach (var itemId in config.AdminPickIds)
                {
                    try
                    {
                        if (Guid.TryParse(itemId, out var guid))
                        {
                            var item = _libraryManager.GetItemById(guid);
                            if (item != null)
                            {
                                adminPickItems.Add(new RecommendationItem
                                {
                                    Title = item.Name,
                                    Type = "Admin's Pick",
                                    Year = item.PremiereDate?.Year.ToString() ?? "",
                                    Rating = item.CommunityRating?.ToString("F1") ?? "N/A"
                                });
                            }
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
                    
                    // Ensure "featuredPick" is in CategoryOrder if it's not already there
                    if (!config.CategoryOrder.Contains("featuredPick"))
                    {
                        config.CategoryOrder.Insert(0, "featuredPick");
                        // Save the updated configuration
                        await SaveDirectConfigurationAsync(config);
                    }
                }
            }
            else
            {
                // Remove "featuredPick" from CategoryOrder if admin picks are disabled
                if (config.CategoryOrder.RemoveAll(c => c == "featuredPick") > 0)
                {
                    // Save the updated configuration
                    await SaveDirectConfigurationAsync(config);
                }
            }
            
            foreach (var categoryVariable in config.CategoryOrder)
            {
                if (categoryItems.ContainsKey(categoryVariable))
                {
                    recommendations.Add(categoryItems[categoryVariable]);
                }
            }
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
    
    private async Task CreateExampleConfigurationAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            var exampleConfigPath = Path.Combine(applicationPaths.DataPath, "jellyfeatured-example-config.json");
            
            var exampleConfig = new
            {
                CategoryOrder = new[]
                {
                    "featuredPick",
                    "latestRelease", 
                    "recentlyAddedFilms",
                    "recentlyAddedSeries",
                    "bestRatedFilms",
                    "bestRatedSeries"
                },
                RefreshIntervalHours = 24,
                EnableAdminPicks = true,
                AdminPickIds = new string[] { },
                _Documentation = new
                {
                    CategoryOrder = "Array of category variables that determine the order of carousels displayed on the home page",
                    AvailableCategories = new
                    {
                        featuredPick = "Admin's Pick (requires EnableAdminPicks: true and AdminPickIds with valid UUIDs)",
                        latestRelease = "Latest Movie Release",
                        recentlyAddedFilms = "Recently Added Films",
                        recentlyAddedSeries = "Recently Added Series",
                        bestRatedFilms = "Best Rated Films",
                        bestRatedSeries = "Best Rated Series"
                    },
                    RefreshIntervalHours = "Number of hours between automatic carousel refreshes (24=daily, 168=weekly, 720=monthly)",
                    EnableAdminPicks = "Boolean to enable/disable admin curated picks feature",
                    AdminPickIds = "Array of Jellyfin media item UUIDs for admin curated content (can be empty array)",
                    Usage = "Copy and modify this structure in the Jellyfin Dashboard > Plugins > Jellyfeatured configuration page"
                }
            };
            
            var jsonString = System.Text.Json.JsonSerializer.Serialize(exampleConfig, new System.Text.Json.JsonSerializerOptions
            {
                WriteIndented = true
            });
            
            await File.WriteAllTextAsync(exampleConfigPath, jsonString);
            _logger.LogInformation("Created example configuration file at: {Path}", exampleConfigPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create example configuration file");
        }
    }
    
    private async Task CreateWebConfigurationFileAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            var webConfigPath = Path.Combine(applicationPaths.WebPath, "jellyfeatured-config.json");
            var config = await GetDirectConfigurationAsync();
            
            var jsonString = JsonSerializer.Serialize(config, new JsonSerializerOptions 
            { 
                WriteIndented = true 
            });
            
            await File.WriteAllTextAsync(webConfigPath, jsonString);
            _logger.LogInformation("Created web-accessible configuration file at: {Path}", webConfigPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create web configuration file");
        }
    }
    
    private string EscapeJs(string input)
    {
        if (string.IsNullOrEmpty(input)) return "";
        return input.Replace("'", "\\'").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r");
    }
    
    private async void StartRefreshTimer(IApplicationPaths applicationPaths)
    {
        try
        {
            var config = await GetDirectConfigurationAsync();
            var refreshInterval = TimeSpan.FromHours(config.RefreshIntervalHours);
            
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