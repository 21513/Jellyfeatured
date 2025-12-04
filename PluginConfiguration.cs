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
    /// Uses variable names for extensibility: featuredPick, latestRelease, recentlyAddedFilms, recentlyAddedSeries, bestRatedFilms, bestRatedSeries
    /// </summary>
    public List<string> CategoryOrder { get; set; } = new List<string>
    {
        "latestRelease",
        "recentlyAddedFilms",
        "recentlyAddedSeries",
        "bestRatedFilms",
        "bestRatedSeries"
    };
    
    /// <summary>
    /// Gets or sets how often recommendations are refreshed (in hours).
    /// Default is 24 hours (daily refresh).
    /// </summary>
    public int RefreshIntervalHours { get; set; } = 24;
    
    /// <summary>
    /// Gets or sets the list of media item IDs for admin picks.
    /// These are Jellyfin media item UUIDs that will be featured in an "Admin's Pick" section.
    /// </summary>
    public List<string> AdminPickIds { get; set; } = new List<string>();
    
    /// <summary>
    /// Gets or sets whether the Admin's Pick section is enabled.
    /// When true, the Admin's Pick section will appear in the carousel with the specified media items.
    /// </summary>
    public bool EnableAdminPicks { get; set; } = false;
    
    /// <summary>
    /// Gets or sets the timestamp of the last manual refresh request.
    /// Used internally to trigger manual refreshes.
    /// </summary>
    public long LastManualRefresh { get; set; } = 0;
}