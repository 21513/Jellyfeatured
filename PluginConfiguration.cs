using MediaBrowser.Model.Plugins;

namespace Jellyfeatured;

/// <summary>
/// Plugin configuration.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets the title for the admin's pick (6th category).
    /// When set, this content will be featured as an additional recommendation.
    /// </summary>
    public string AdminPickTitle { get; set; } = "";
    
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