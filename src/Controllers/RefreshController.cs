using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfeatured.Controllers
{
    [ApiController]
    [Route("Plugins/Jellyfeatured")]
    public class RefreshController : ControllerBase
    {
        [HttpPost("refresh")]
        public async Task<IActionResult> Refresh()
        {
            try
            {
                if (Plugin.Instance == null)
                {
                    return NotFound("Jellyfeatured plugin instance not available");
                }

                await Plugin.Instance.TriggerRefresh();
                return Ok(new { status = "refresh_started" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }

        /// <summary>
        /// Deletes legacy files written by the old file-based injection and cleans
        /// up any old script tags from index.html.
        /// </summary>
        [HttpPost("CleanupLegacy")]
        public async Task<IActionResult> CleanupLegacy()
        {
            if (Plugin.Instance == null)
                return NotFound("Plugin instance not available");

            var (deleted, modified, errors) = await Plugin.Instance.CleanupLegacyFilesAsync();
            return Ok(new { deleted, modified, errors });
        }

        /// <summary>
        /// Serves the carousel inject script with recommendations baked in.
        /// Referenced by the script tag that the middleware injects into index.html.
        /// Must be anonymous — the browser loads this as a plain &lt;script src&gt; tag
        /// before the user authenticates, so no auth header is present.
        /// </summary>
        [AllowAnonymous]
        [HttpGet("fast-forward.svg")]
        [Produces("image/svg+xml")]
        public async Task<IActionResult> GetFastForwardSvg()
        {
            if (Plugin.Instance == null)
                return NotFound();

            var svg = await Plugin.Instance.GetEmbeddedSvgAsync("Jellyfeatured.icons.fast-forward.svg");
            if (string.IsNullOrEmpty(svg))
                return NotFound();

            return Content(svg, "image/svg+xml");
        }

        [AllowAnonymous]
        [HttpGet("arrow-left.svg")]
        [Produces("image/svg+xml")]
        public async Task<IActionResult> GetArrowLeftSvg()
        {
            if (Plugin.Instance == null)
                return NotFound();

            var svg = await Plugin.Instance.GetEmbeddedSvgAsync("Jellyfeatured.icons.arrow-left.svg");
            if (string.IsNullOrEmpty(svg))
                return NotFound();

            return Content(svg, "image/svg+xml");
        }

        [AllowAnonymous]
        [HttpGet("arrow-right.svg")]
        [Produces("image/svg+xml")]
        public async Task<IActionResult> GetArrowRightSvg()
        {
            if (Plugin.Instance == null)
                return NotFound();

            var svg = await Plugin.Instance.GetEmbeddedSvgAsync("Jellyfeatured.icons.arrow-right.svg");
            if (string.IsNullOrEmpty(svg))
                return NotFound();

            return Content(svg, "image/svg+xml");
        }

        [AllowAnonymous]
        [HttpGet("Script")]
        [Produces("application/javascript")]
        public async Task<IActionResult> GetScript()
        {
            if (Plugin.Instance == null)
            {
                return NotFound();
            }

            var script = await Plugin.Instance.GetInjectScriptAsync();
            if (string.IsNullOrEmpty(script))
            {
                return NotFound();
            }

            return Content(script, "application/javascript");
        }
    }
}
