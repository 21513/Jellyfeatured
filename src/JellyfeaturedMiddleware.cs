using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace Jellyfeatured;

/// <summary>
/// HTTP middleware that intercepts Jellyfin's index.html response and injects
/// the Jellyfeatured carousel script tag in-memory.
/// No files are written to disk; the script itself is served via the plugin's
/// own API endpoint at /Plugins/Jellyfeatured/Script.
/// </summary>
public class JellyfeaturedMiddleware : IMiddleware
{
    private const string ScriptTag = "<script src=\"/Plugins/Jellyfeatured/Script\"></script>";

    /// <inheritdoc />
    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        var path = context.Request.Path.Value ?? string.Empty;

        // Only intercept requests that could be serving index.html.
        bool couldBeIndex =
            path.EndsWith("index.html", StringComparison.OrdinalIgnoreCase) ||
            path.Equals("/web/", StringComparison.OrdinalIgnoreCase) ||
            path.Equals("/", StringComparison.OrdinalIgnoreCase);

        if (!couldBeIndex)
        {
            await next(context);
            return;
        }

        // Remove Accept-Encoding so Jellyfin's compression middleware serves plain
        // UTF-8 HTML. Without this, the response may be gzip-compressed and we would
        // corrupt it by trying to read compressed bytes as a string.
        context.Request.Headers.Remove("Accept-Encoding");

        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;

        try
        {
            await next(context);

            bool isHtml = context.Response.ContentType?.Contains("text/html", StringComparison.OrdinalIgnoreCase) == true;
            bool isSuccess = context.Response.StatusCode is >= 200 and < 300;

            if (isHtml && isSuccess)
            {
                buffer.Seek(0, SeekOrigin.Begin);
                var body = await new StreamReader(buffer, Encoding.UTF8).ReadToEndAsync();

                if (body.Contains("</head>") && !body.Contains("jellyfeatured", StringComparison.OrdinalIgnoreCase))
                {
                    body = body.Replace("</head>", ScriptTag + "\n</head>", StringComparison.OrdinalIgnoreCase);
                }

                var bytes = Encoding.UTF8.GetBytes(body);
                // We're writing plain UTF-8 — remove any Content-Encoding header that
                // compression middleware may have added before we stripped Accept-Encoding.
                context.Response.Headers.Remove("Content-Encoding");
                context.Response.ContentLength = bytes.Length;
                context.Response.Body = originalBody;
                await originalBody.WriteAsync(bytes);
                return;
            }

            // Not HTML (e.g. a redirect) — copy raw bytes unchanged.
            buffer.Seek(0, SeekOrigin.Begin);
            context.Response.Body = originalBody;
            await buffer.CopyToAsync(originalBody);
        }
        finally
        {
            context.Response.Body = originalBody;
        }
    }
}
