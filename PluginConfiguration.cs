using MediaBrowser.Model.Plugins;

namespace Jellyfeatured;

/// <summary>
/// Plugin configuration.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets a value indicating whether the carousel auto-slide is enabled.
    /// </summary>
    public bool EnableAutoSlide { get; set; } = true;
    
    /// <summary>
    /// Gets or sets the auto-slide interval in seconds.
    /// </summary>
    public int AutoSlideInterval { get; set; } = 6;
    
    /// <summary>
    /// Gets or sets the number of recommendations per category.
    /// </summary>
    public int RecommendationsPerCategory { get; set; } = 1;
    
    /// <summary>
    /// Gets or sets a value indicating whether to show movie recommendations.
    /// </summary>
    public bool ShowMovieRecommendations { get; set; } = true;
    
    /// <summary>
    /// Gets or sets a value indicating whether to show series recommendations.
    /// </summary>
    public bool ShowSeriesRecommendations { get; set; } = true;
    
    /// <summary>
    /// Gets or sets a value indicating whether to enable the hover effect.
    /// </summary>
    public bool EnableHoverEffect { get; set; } = true;
    
    /// <summary>
    /// Gets or sets a value indicating whether to show ratings in the carousel.
    /// </summary>
    public bool ShowRatings { get; set; } = true;
    
    /// <summary>
    /// Gets or sets the title for the admin's pick (6th category).
    /// </summary>
    public string AdminPickTitle { get; set; } = "";
}