using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
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
        var random = new Random();
        
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
            
            // 1. Most recently released movies by release date (get top 5, pick random)
            var latestMovies = allItems
                .OfType<Movie>()
                .Where(m => m.PremiereDate.HasValue)
                .OrderByDescending(m => m.PremiereDate)
                .Take(5)
                .ToList();
                
            if (latestMovies.Any())
            {
                var selectedMovie = latestMovies[random.Next(latestMovies.Count)];
                recommendations.Add(new RecommendationItem
                {
                    Title = selectedMovie.Name,
                    Type = "Latest Release",
                    Year = selectedMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = selectedMovie.CommunityRating?.ToString("F1") ?? "N/A"
                });
            }
            
            // 2. Most recently added movies (get top 5, pick random)
            var recentAddedMovies = allItems
                .OfType<Movie>()
                .OrderByDescending(m => m.DateCreated)
                .Take(5)
                .ToList();
                
            if (recentAddedMovies.Any())
            {
                var selectedMovie = recentAddedMovies[random.Next(recentAddedMovies.Count)];
                recommendations.Add(new RecommendationItem
                {
                    Title = selectedMovie.Name,
                    Type = "Recently Added in Films",
                    Year = selectedMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = selectedMovie.CommunityRating?.ToString("F1") ?? "N/A"
                });
            }
            
            // 3. Most recently added shows (get top 5, pick random)
            var recentAddedShows = allItems
                .OfType<Series>()
                .OrderByDescending(s => s.DateCreated)
                .Take(5)
                .ToList();
                
            if (recentAddedShows.Any())
            {
                var selectedShow = recentAddedShows[random.Next(recentAddedShows.Count)];
                recommendations.Add(new RecommendationItem
                {
                    Title = selectedShow.Name,
                    Type = "Recently Added in Series",
                    Year = selectedShow.PremiereDate?.Year.ToString() ?? "",
                    Rating = selectedShow.CommunityRating?.ToString("F1") ?? "N/A"
                });
            }
            
            // 4. Best rated movies (get top 5, pick random)
            var bestMovies = allItems
                .OfType<Movie>()
                .Where(m => m.CommunityRating.HasValue && m.CommunityRating > 0 && m.CommunityRating < 10.0)
                .OrderByDescending(m => m.CommunityRating)
                .Take(5)
                .ToList();
                
            if (bestMovies.Any())
            {
                var selectedMovie = bestMovies[random.Next(bestMovies.Count)];
                recommendations.Add(new RecommendationItem
                {
                    Title = selectedMovie.Name,
                    Type = "Best Rated in Films",
                    Year = selectedMovie.PremiereDate?.Year.ToString() ?? "",
                    Rating = selectedMovie.CommunityRating?.ToString("F1") ?? "N/A"
                });
            }
            
            // 5. Best rated shows (get top 5, pick random)
            var bestShows = allItems
                .OfType<Series>()
                .Where(s => s.CommunityRating.HasValue && s.CommunityRating > 0 && s.CommunityRating < 10.0)
                .OrderByDescending(s => s.CommunityRating)
                .Take(5)
                .ToList();
                
            if (bestShows.Any())
            {
                var selectedShow = bestShows[random.Next(bestShows.Count)];
                recommendations.Add(new RecommendationItem
                {
                    Title = selectedShow.Name,
                    Type = "Best Rated in Series",
                    Year = selectedShow.PremiereDate?.Year.ToString() ?? "",
                    Rating = selectedShow.CommunityRating?.ToString("F1") ?? "N/A"
                });
            }
            
            _logger.LogInformation($"✅ Generated {recommendations.Count} randomized recommendations from top candidates");
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