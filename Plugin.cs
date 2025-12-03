using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Text.Json;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Model.Querying;
using Microsoft.Extensions.Logging;
using Jellyfin.Data.Enums;

namespace Jellyfeatured;

/// <summary>
/// The main plugin class.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>
{
    private readonly ILibraryManager _libraryManager;
    private readonly ILogger<Plugin> _logger;
    private readonly string _recommendationsPath;

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
        _recommendationsPath = Path.Combine(applicationPaths.DataPath, "jellyfeatured-recommendations.json");
        
        _logger.LogInformation("🎬 Jellyfeatured Plugin: Starting initialization...");
        
        // Generate recommendations and create web resources
        _ = Task.Run(async () => await InitializePluginAsync(applicationPaths));
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
            
            // 1. Most recently released movie by release date
            var latestMovie = allItems
                .OfType<Movie>()
                .Where(m => m.PremiereDate.HasValue)
                .OrderByDescending(m => m.PremiereDate)
                .FirstOrDefault();
                
            if (latestMovie != null)
            {
                recommendations.Add(new RecommendationItem
                {
                    Title = latestMovie.Name,
                    Type = "Most Recently Released Movie",
                    Year = latestMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = latestMovie.CommunityRating?.ToString("F1") ?? "N/A"
                });
            }
            
            // 2. Most recently added movie
            var recentAddedMovie = allItems
                .OfType<Movie>()
                .OrderByDescending(m => m.DateCreated)
                .FirstOrDefault();
                
            if (recentAddedMovie != null)
            {
                recommendations.Add(new RecommendationItem
                {
                    Title = recentAddedMovie.Name,
                    Type = "Most Recently Added Movie",
                    Year = recentAddedMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = recentAddedMovie.CommunityRating?.ToString("F1") ?? "N/A"
                });
            }
            
            // 3. Most recently added show
            var recentAddedShow = allItems
                .OfType<Series>()
                .OrderByDescending(s => s.DateCreated)
                .FirstOrDefault();
                
            if (recentAddedShow != null)
            {
                recommendations.Add(new RecommendationItem
                {
                    Title = recentAddedShow.Name,
                    Type = "Most Recently Added Show",
                    Year = recentAddedShow.PremiereDate?.Year.ToString() ?? "",
                    Rating = recentAddedShow.CommunityRating?.ToString("F1") ?? "N/A"
                });
            }
            
            // 4. Best rated movie
            var bestMovie = allItems
                .OfType<Movie>()
                .Where(m => m.CommunityRating.HasValue && m.CommunityRating > 0)
                .OrderByDescending(m => m.CommunityRating)
                .FirstOrDefault();
                
            if (bestMovie != null)
            {
                recommendations.Add(new RecommendationItem
                {
                    Title = bestMovie.Name,
                    Type = "Best Rated Movie",
                    Year = bestMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = bestMovie.CommunityRating?.ToString("F1") ?? "N/A"
                });
            }
            
            // 5. Best rated show
            var bestShow = allItems
                .OfType<Series>()
                .Where(s => s.CommunityRating.HasValue && s.CommunityRating > 0)
                .OrderByDescending(s => s.CommunityRating)
                .FirstOrDefault();
                
            if (bestShow != null)
            {
                recommendations.Add(new RecommendationItem
                {
                    Title = bestShow.Name,
                    Type = "Best Rated Show",
                    Year = bestShow.PremiereDate?.Year.ToString() ?? "",
                    Rating = bestShow.CommunityRating?.ToString("F1") ?? "N/A"
                });
            }
            
            _logger.LogInformation($"✅ Generated {recommendations.Count} recommendations");
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
            
            // Create JavaScript array from recommendations
            var recommendationsJs = string.Join(",\n        ", recommendations.Select(r => 
                $"{{ title: '{EscapeJs(r.Title)}', type: '{EscapeJs(r.Type)}', year: '{EscapeJs(r.Year)}', rating: '{EscapeJs(r.Rating)}' }}"));
            
            var scriptContent = $@"
// Jellyfeatured Auto-Injector with Recommendations
console.log('🎬 Jellyfeatured: Auto-injector loaded');

const recommendations = [
        {recommendationsJs}
    ];

(function() {{
    function createFeaturedDiv() {{
        if (document.getElementById('jellyfeatured-div')) return;
        
        const pathname = window.location.pathname;
        if (!pathname.includes('home') && pathname !== '/' && pathname !== '/web/' && pathname !== '/web/index.html') {{
            return;
        }}
        
        console.log('🎬 Jellyfeatured: Attempting injection...');
        
        const targetContainer = document.querySelector('.homePage');
        if (targetContainer) {{
            const featuredDiv = document.createElement('div');
            featuredDiv.id = 'jellyfeatured-div';
            featuredDiv.style.cssText = `
                width: 100%;
                margin: 20px 0;
                padding: 20px;
                background: linear-gradient(135deg, #1e3a8a, #3b82f6);
                border-radius: 12px;
                color: white;
                position: relative;
                z-index: 1000;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
            `;
            
            // Create recommendation HTML
            let recommendationsHtml = '<h2 style=""margin: 0 0 15px 0; font-size: 24px;"">🎬 Featured Recommendations</h2>';
            if (recommendations.length > 0) {{
                recommendationsHtml += '<div style=""display: grid; gap: 10px;"">';
                recommendations.forEach((rec, index) => {{
                    recommendationsHtml += `
                        <div style=""background: rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;"">
                            <div>
                                <div style=""font-weight: bold; font-size: 16px;"">${{rec.title}} ${{rec.year ? '(' + rec.year + ')' : ''}}</div>
                                <div style=""font-size: 12px; opacity: 0.8; margin-top: 2px;"">${{rec.type}}</div>
                            </div>
                            <div style=""font-size: 14px; font-weight: bold; background: rgba(255,255,255,0.2); padding: 4px 8px; border-radius: 4px;"">
                                ⭐ ${{rec.rating}}
                            </div>
                        </div>
                    `;
                }});
                recommendationsHtml += '</div>';
            }} else {{
                recommendationsHtml += '<p style=""opacity: 0.8;"">Loading recommendations...</p>';
            }}
            
            featuredDiv.innerHTML = recommendationsHtml;
            
            targetContainer.insertBefore(featuredDiv, targetContainer.firstChild);
            console.log('✅ Jellyfeatured: Successfully injected recommendations!');
        }}
    }}
    
    // Multiple injection attempts
    createFeaturedDiv();
    setTimeout(createFeaturedDiv, 500);
    setTimeout(createFeaturedDiv, 1000);
    setTimeout(createFeaturedDiv, 2000);
    
    // Watch for navigation changes
    const observer = new MutationObserver(() => setTimeout(createFeaturedDiv, 300));
    if (document.body) observer.observe(document.body, {{ childList: true, subtree: true }});
    
    // URL change detection
    let lastUrl = location.href;
    setInterval(() => {{
        if (location.href !== lastUrl) {{
            lastUrl = location.href;
            setTimeout(createFeaturedDiv, 200);
        }}
    }}, 1000);
}})();";
            
            await File.WriteAllTextAsync(webPath, scriptContent);
            _logger.LogInformation("📄 Created enhanced web script with recommendations");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Failed to create web script");
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

    /// <inheritdoc />
    public override string Name => "Jellyfeatured";

    /// <inheritdoc />
    public override string Description => "Get recommendations on your home page";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("639b5171-918b-4b24-82e4-d35c10be63a4");
}

public class RecommendationItem
{
    public string Title { get; set; } = "";
    public string Type { get; set; } = "";
    public string Year { get; set; } = "";
    public string Rating { get; set; } = "";
}