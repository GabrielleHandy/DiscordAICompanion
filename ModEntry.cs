using System;
using System.Net.Http;
using System.Text;
using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;

namespace DiscordAICompanion
{
    public class ModEntry : Mod
    {
        private static readonly HttpClient client = new HttpClient();
        private const string NodeServerUrl = "http://localhost:3000/api/stardew-update";

        public override void Entry(IModHelper helper)
        {
            // Hook into the game clock ticking (runs every 10 in-game minutes)
            helper.Events.GameLoop.TimeChanged += OnTimeChanged;
        }

        private async void OnTimeChanged(object? sender, TimeChangedEventArgs e)
        {
            if (!Context.IsWorldReady || Game1.player == null) return;

            var player = Game1.player;
            
            // Package the data up nicely
            var payload = new
            {
                name = player.Name,
                farmName = player.farmName.Value,
                location = player.currentLocation?.Name ?? "Unknown",
                currentStamina = (int)player.Stamina,
                maxStamina = player.MaxStamina,
                money = player.Money,
                timeOfDay = Game1.getTimeOfDayString(Game1.timeOfDay),
                currentTool = player.CurrentTool?.DisplayName ?? "None"
            };

            try
            {
                var json = Newtonsoft.Json.JsonConvert.SerializeObject(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                await client.PostAsync(NodeServerUrl, content);
            }
            catch (Exception)
            {
                // Node server might be offline, ignore silently so the game doesn't crash
            }
        }
    }
}