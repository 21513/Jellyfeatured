using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfeatured;

/// <summary>
/// Background service that runs when Jellyfin starts.
/// </summary>
public class JellyfeaturedService : IHostedService
{
    private readonly ILogger<JellyfeaturedService> _logger;

    public JellyfeaturedService(ILogger<JellyfeaturedService> logger)
    {
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation("🎬 Jellyfeatured Service Started Successfully!");
            
            // Create a simple test to verify the service is running
            _logger.LogInformation("Jellyfeatured: Ready to inject web content");
            
            return Task.CompletedTask;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start Jellyfeatured service");
            return Task.CompletedTask;
        }
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Jellyfeatured Service Stopped");
        return Task.CompletedTask;
    }
}