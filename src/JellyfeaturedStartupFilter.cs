using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace Jellyfeatured;

/// <summary>
/// Ensures <see cref="JellyfeaturedMiddleware"/> is placed at the very front of
/// the ASP.NET Core middleware pipeline so it wraps Jellyfin's static-file
/// middleware and can modify the index.html response.
/// </summary>
public class JellyfeaturedStartupFilter : IStartupFilter
{
    /// <inheritdoc />
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return builder =>
        {
            builder.UseMiddleware<JellyfeaturedMiddleware>();
            next(builder);
        };
    }
}
