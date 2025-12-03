using System;
using System.IO;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfeatured;

/// <summary>
/// The main plugin class.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>
{
    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Instance of the <see cref="IApplicationPaths"/> interface.</param>
    /// <param name="xmlSerializer">Instance of the <see cref="IXmlSerializer"/> interface.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        // Create the injection script in Jellyfin's web directory
        try
        {
            var webPath = Path.Combine(applicationPaths.WebPath, "jellyfeatured-inject.js");
            var scriptContent = @"
// Jellyfeatured Auto-Injector
console.log('🎬 Jellyfeatured: Auto-injector loaded');

(function() {
    function createFeaturedDiv() {
        if (document.getElementById('jellyfeatured-div')) return;
        
        const pathname = window.location.pathname;
        if (!pathname.includes('home') && pathname !== '/' && pathname !== '/web/' && pathname !== '/web/index.html') {
            return;
        }
        
        console.log('🎬 Jellyfeatured: Attempting injection...');
        
        const targetContainer = document.querySelector('.homePage');
        if (targetContainer) {
            const featuredDiv = document.createElement('div');
            featuredDiv.id = 'jellyfeatured-div';
            featuredDiv.style.cssText = `
                width: 100%;
                height: 180px;
                background: linear-gradient(135deg, #1e3a8a, #3b82f6);
                margin: 20px 0;
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 22px;
                font-weight: bold;
                position: relative;
                z-index: 1000;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
            `;
            featuredDiv.innerHTML = '🎬 Jellyfeatured - Featured Content Plugin Active! 🎬';
            
            targetContainer.insertBefore(featuredDiv, targetContainer.firstChild);
            console.log('✅ Jellyfeatured: Successfully injected!');
        }
    }
    
    // Multiple injection attempts
    createFeaturedDiv();
    setTimeout(createFeaturedDiv, 500);
    setTimeout(createFeaturedDiv, 1000);
    setTimeout(createFeaturedDiv, 2000);
    
    // Watch for navigation changes
    const observer = new MutationObserver(() => setTimeout(createFeaturedDiv, 300));
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    
    // URL change detection
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(createFeaturedDiv, 200);
        }
    }, 1000);
})();";
            
            File.WriteAllText(webPath, scriptContent);
            
            // Also try to inject into index.html if it exists
            var indexPath = Path.Combine(applicationPaths.WebPath, "index.html");
            if (File.Exists(indexPath))
            {
                var indexContent = File.ReadAllText(indexPath);
                var scriptTag = "<script src=\"/web/jellyfeatured-inject.js\"></script>";
                
                if (!indexContent.Contains("jellyfeatured-inject.js"))
                {
                    if (indexContent.Contains("</head>"))
                    {
                        indexContent = indexContent.Replace("</head>", scriptTag + "\n</head>");
                        File.WriteAllText(indexPath, indexContent);
                    }
                }
            }
        }
        catch (Exception)
        {
            // Silently fail if we can't write to web directory
        }
    }

    /// <inheritdoc />
    public override string Name => "Jellyfeatured";

    /// <inheritdoc />
    public override string Description => "Get recommendations on your home page";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("639b5171-918b-4b24-82e4-d35c10be63a4");
}