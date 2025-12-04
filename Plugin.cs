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
using MediaBrowser.Model.Querying;
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
        _libraryManager = libraryManager;
        _logger = logger;
        _applicationPaths = applicationPaths;
        _recommendationsPath = Path.Combine(applicationPaths.DataPath, "jellyfeatured-recommendations.json");
        
        _logger.LogInformation("🎬 Jellyfeatured Plugin: Starting initialization...");
        
        // Generate recommendations and create web resources
        _ = Task.Run(async () => await InitializePluginAsync(applicationPaths));
        
        // Start periodic refresh timer
        StartRefreshTimer(applicationPaths);
        
        // Subscribe to configuration changes
        ConfigurationChanged += OnConfigurationChanged;
    }
    
    private void OnConfigurationChanged(object? sender, BasePluginConfiguration e)
    {
        var config = (PluginConfiguration)e;
        
        // Check if this is a manual refresh request
        if (config.LastManualRefresh > 0)
        {
            _logger.LogInformation("🔄 Manual refresh requested, triggering immediate refresh...");
            _ = Task.Run(async () => await RefreshRecommendations(_applicationPaths));
        }
        
        _logger.LogInformation("🔧 Configuration changed, restarting refresh timer...");
        
        // Restart timer with new interval
        _refreshTimer?.Dispose();
        StartRefreshTimer(_applicationPaths);
    }

    private async Task InitializePluginAsync(IApplicationPaths applicationPaths)
    {
        try
        {
            // Generate fresh recommendations
            var recommendations = await GenerateRecommendationsAsync();
            
            // Save recommendations to file
            await SaveRecommendationsAsync(recommendations);
            
            // Create the enhanced injection script
            await CreateWebScriptAsync(applicationPaths, recommendations);
            
            // Try to inject into index.html
            await InjectIntoIndexHtmlAsync(applicationPaths);
            
            _logger.LogInformation("✅ Jellyfeatured Plugin: Initialization complete!");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Jellyfeatured Plugin: Initialization failed");
        }
    }
    private async Task<List<RecommendationItem>> GenerateRecommendationsAsync()
    {
        var recommendations = new List<RecommendationItem>();
        var categoryItems = new Dictionary<string, RecommendationItem>();
        
        try
        {
            _logger.LogInformation("🎬 Generating Jellyfin recommendations...");
            
            var allItems = _libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = new[] { BaseItemKind.Movie, BaseItemKind.Series },
                IsVirtualItem = false
            }).ToList();
            
            // Wait a small amount to make this truly async
            await Task.Delay(1);
            
            // Generate all available categories
            
            // 1. Most recently released movie by release date
            var latestMovie = allItems
                .OfType<Movie>()
                .Where(m => m.PremiereDate.HasValue)
                .OrderByDescending(m => m.PremiereDate)
                .FirstOrDefault();
                
            if (latestMovie != null)
            {
                categoryItems["Latest Release"] = new RecommendationItem
                {
                    Title = latestMovie.Name,
                    Type = "Latest Release",
                    Year = latestMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = latestMovie.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            // 2. Most recently added movie
            var recentAddedMovie = allItems
                .OfType<Movie>()
                .OrderByDescending(m => m.DateCreated)
                .FirstOrDefault();
                
            if (recentAddedMovie != null)
            {
                categoryItems["Recently Added in Films"] = new RecommendationItem
                {
                    Title = recentAddedMovie.Name,
                    Type = "Recently Added in Films",
                    Year = recentAddedMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = recentAddedMovie.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            // 3. Most recently added show
            var recentAddedShow = allItems
                .OfType<Series>()
                .OrderByDescending(s => s.DateCreated)
                .FirstOrDefault();
                
            if (recentAddedShow != null)
            {
                categoryItems["Recently Added in Series"] = new RecommendationItem
                {
                    Title = recentAddedShow.Name,
                    Type = "Recently Added in Series",
                    Year = recentAddedShow.PremiereDate?.Year.ToString() ?? "",
                    Rating = recentAddedShow.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            // 4. Best rated movie
            var bestMovie = allItems
                .OfType<Movie>()
                .Where(m => m.CommunityRating.HasValue && m.CommunityRating > 0 && m.CommunityRating < 10.0)
                .OrderByDescending(m => m.CommunityRating)
                .FirstOrDefault();
                
            if (bestMovie != null)
            {
                categoryItems["Best Rated in Films"] = new RecommendationItem
                {
                    Title = bestMovie.Name,
                    Type = "Best Rated in Films",
                    Year = bestMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = bestMovie.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            // 5. Best rated show
            var bestShow = allItems
                .OfType<Series>()
                .Where(s => s.CommunityRating.HasValue && s.CommunityRating > 0 && s.CommunityRating < 10.0)
                .OrderByDescending(s => s.CommunityRating)
                .FirstOrDefault();
                
            if (bestShow != null)
            {
                categoryItems["Best Rated in Series"] = new RecommendationItem
                {
                    Title = bestShow.Name,
                    Type = "Best Rated in Series",
                    Year = bestShow.PremiereDate?.Year.ToString() ?? "",
                    Rating = bestShow.CommunityRating?.ToString("F1") ?? "N/A"
                };
            }
            
            // Add recommendations in the configured order
            foreach (var categoryName in Configuration.CategoryOrder)
            {
                if (categoryItems.ContainsKey(categoryName))
                {
                    recommendations.Add(categoryItems[categoryName]);
                }
            }
            
            _logger.LogInformation($"✅ Generated {recommendations.Count} recommendations in configured order");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to generate recommendations");
        }
        
        return recommendations;
    }
    
    private async Task SaveRecommendationsAsync(List<RecommendationItem> recommendations)
    {
        try
        {
            var json = JsonSerializer.Serialize(recommendations, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(_recommendationsPath, json);
            _logger.LogInformation($"💾 Saved recommendations to: {_recommendationsPath}");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to save recommendations");
        }
    }
    
    private async Task CreateWebScriptAsync(IApplicationPaths applicationPaths, List<RecommendationItem> recommendations)
    {
        try
        {
            var webPath = Path.Combine(applicationPaths.WebPath, "jellyfeatured-inject.js");
            var assembly = Assembly.GetExecutingAssembly();
            
            // Load templates from embedded resources
            var htmlInject = await LoadEmbeddedResourceAsync(assembly, "Jellyfeatured.main.html");
            var jsInject = await LoadEmbeddedResourceAsync(assembly, "Jellyfeatured.main.js");
            var cssInject = await LoadEmbeddedResourceAsync(assembly, "Jellyfeatured.main.css");
            
            // Create JavaScript array from recommendations
            var recommendationsJs = string.Join(",\n        ", recommendations.Select(r => 
                $"{{ title: '{EscapeJs(r.Title)}', type: '{EscapeJs(r.Type)}', year: '{EscapeJs(r.Year)}', rating: '{EscapeJs(r.Rating)}' }}"));
            
            // Replace placeholders in templates
            var processedHtml = htmlInject.Replace("{{CSS_STYLES}}", cssInject);
            var scriptContent = jsInject
                .Replace("{{RECOMMENDATIONS_DATA}}", recommendationsJs)
                .Replace("{{HTML_TEMPLATE}}", EscapeJs(processedHtml));
            
            await File.WriteAllTextAsync(webPath, scriptContent);
            _logger.LogInformation("📄 Created enhanced web script with recommendations from templates");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to create web script");
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
                _logger.LogWarning($"Could not find embedded resource: {resourceName}");
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
                    if (indexContent.Contains("</head>"))
                    {
                        indexContent = indexContent.Replace("</head>", scriptTag + "\n</head>");
                        await File.WriteAllTextAsync(indexPath, indexContent);
                        _logger.LogInformation("📝 Injected script into index.html");
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to inject into index.html");
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
            _logger.LogInformation($"🕒 Setting up refresh timer for every {Configuration.RefreshIntervalHours} hours");
            
            _refreshTimer = new Timer(async _ => await RefreshRecommendations(applicationPaths), 
                null, refreshInterval, refreshInterval);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to start refresh timer");
        }
    }
    
    private async Task RefreshRecommendations(IApplicationPaths applicationPaths)
    {
        try
        {
            _logger.LogInformation("🔄 Starting periodic refresh of recommendations...");
            
            // Generate fresh recommendations
            var recommendations = await GenerateRecommendationsAsync();
            
            // Save recommendations to file
            await SaveRecommendationsAsync(recommendations);
            
            // Create the enhanced injection script
            await CreateWebScriptAsync(applicationPaths, recommendations);
            
            _logger.LogInformation("✅ Periodic refresh completed successfully!");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Periodic refresh failed");
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
                Name = this.Name,
                EmbeddedResourcePath = string.Format("{0}.Configuration.configPage.html", GetType().Namespace)
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