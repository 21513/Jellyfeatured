using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfeatured.Controllers
{
    [ApiController]
    [Route("plugins/jellyfeatured")]
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
    }
}
