using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfeatured;

/// <summary>
/// Registers Jellyfeatured services with the DI container, including the
/// response-modification middleware that injects the carousel script tag into
/// Jellyfin's index.html without writing any files to disk.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddTransient<JellyfeaturedMiddleware>();
        serviceCollection.AddSingleton<IStartupFilter, JellyfeaturedStartupFilter>();
    }
}
