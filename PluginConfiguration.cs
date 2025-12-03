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
}