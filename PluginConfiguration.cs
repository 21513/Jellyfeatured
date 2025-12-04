using MediaBrowser.Model.Plugins;
using System.Collections.Generic;

namespace Jellyfeatured;

/// <summary>
/// Plugin configuration.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets the order in which categories are displayed.
    /// Default order: Latest Release, Recently Added Films, Recently Added Series, Best Rated Films, Best Rated Series
    /// </summary>
    public List<string> CategoryOrder { get; set; } = new List<string>
    {
        "Latest Release",
        "Recently Added in Films", 
        "Recently Added in Series",
        "Best Rated in Films",
        "Best Rated in Series"
    };
    
    /// <summary>
    /// Gets or sets how often recommendations are refreshed (in hours).
    /// Default is 24 hours (daily refresh).
    /// </summary>
    public int RefreshIntervalHours { get; set; } = 24;
    
    /// <summary>
    /// Gets or sets the timestamp of the last manual refresh request.
    /// Used internally to trigger manual refreshes.
    /// </summary>
    public long LastManualRefresh { get; set; } = 0;
}