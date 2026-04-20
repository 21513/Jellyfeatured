using MediaBrowser.Model.Plugins;
using System.Collections.Generic;

namespace Jellyfeatured;

/// <summary>
/// Plugin configuration.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    
    /// <summary>
    /// Gets or sets how often recommendations are refreshed (in hours).
    /// Default is 24 hours (daily refresh).
    /// </summary>
    public int RefreshIntervalHours { get; set; } = 24;

    /// <summary>
    /// Gets or sets how long each featured item is shown before the carousel
    /// advances automatically (in seconds). Default is 6 seconds.
    /// </summary>
    public int AutoSlideIntervalSeconds { get; set; } = 6;

    /// <summary>
    /// Gets or sets the display order of carousel categories.
    /// Only categories listed here will appear, in the specified order.
    /// Valid keys: latestRelease, recentlyAddedFilms, recentlyAddedSeries,
    /// bestRatedFilms, bestRatedSeries, trending, randomPick, featured_&lt;id&gt;.
    /// If empty, the default order is used.
    /// </summary>
    public List<string> CategoryOrder { get; set; } = new List<string>();
    
    /// <summary>
    /// Gets or sets the list of media item IDs for the Custom List.
    /// Each item will be displayed as "Featured" in the carousel when enabled.
    /// </summary>
    public List<string> FeaturedItemIds { get; set; } = new List<string>();
    
    /// <summary>
    /// Gets or sets the timestamp of the last manual refresh request.
    /// Used internally to trigger manual refreshes.
    /// </summary>
    public long LastManualRefresh { get; set; } = 0;
}