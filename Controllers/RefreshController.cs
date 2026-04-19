using System;
using System.Threading.Tasks;
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
        /// Serves the carousel inject script with recommendations baked in.
        /// Referenced by the script tag that the middleware injects into index.html.
        /// </summary>
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
