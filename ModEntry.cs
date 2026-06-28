using System.Text;
using StardewModdingAPI;
using StardewModdingAPI.Events;
using StardewValley;
using StardewValley.Pathfinding; // Added for PathFindController
using Microsoft.Xna.Framework;

namespace DiscordAICompanion
{
    public class ModEntry : Mod
    {
        private static readonly HttpClient client = new HttpClient();
        private const string NodeServerUrl = "http://localhost:3000/api/town-override";

        public override void Entry(IModHelper helper)
        {
            helper.Events.GameLoop.TimeChanged += OnTownTick;
        }

        private async void OnTownTick(object? sender, TimeChangedEventArgs e) // Changed object sender to object? sender
        {
            if (!Context.IsWorldReady) return;

            var villagersData = new List<object>();

            foreach (var npc in Utility.getAllCharacters())
            {
                if (npc.IsVillager && !npc.IsMonster) // Changed npc.isVillager() to npc.IsVillager()
                {
                    villagersData.Add(new
                    {
                        npcName = npc.Name,
                        location = npc.currentLocation?.Name ?? "Unknown",
                        tileX = npc.TilePoint.X,
                        tileY = npc.TilePoint.Y
                    });
                }
            }

            var payload = new
            {
                timeOfDay = Game1.getTimeOfDayString(Game1.timeOfDay),
                season = Game1.currentSeason,
                weather = Game1.isRaining ? "Raining" : Game1.isSnowing ? "Snowing" : "Sunny",
                villagers = villagersData
            };

            try
            {
                var json = Newtonsoft.Json.JsonConvert.SerializeObject(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                
                // Send state AND wait for the AI's direct instructions
                var response = await client.PostAsync(NodeServerUrl, content);
                if (response.IsSuccessStatusCode)
                {
                    var responseString = await response.Content.ReadAsStringAsync();
                    var overrides = Newtonsoft.Json.JsonConvert.DeserializeObject<List<NpcOverride>>(responseString);

                    if (overrides != null)
                    {
                        foreach (var choice in overrides)
                        {
                            NPC townsperson = Game1.getCharacterFromName(choice.NpcName);
                            GameLocation targetLocation = Game1.getLocationFromName(choice.TargetLocationName);

                            if (townsperson != null && targetLocation != null)
                            {
                                // Injects the movement path into Stardew's pathfinding system
                                townsperson.controller = new PathFindController(
                                    townsperson,
                                    targetLocation,
                                    new Point(choice.TargetX, choice.TargetY),
                                    2 // Default to facing down on arrival
                                );
                            }
                        }
                    }
                }
            }
            catch (Exception)
            {
                // Fail silently to safeguard gameplay frame rates
            }
        }
    }

    public class NpcOverride
    {
        public string NpcName { get; set; } = "";
        public string TargetLocationName { get; set; } = "";
        public int TargetX { get; set; }
        public int TargetY { get; set; }
    }
}