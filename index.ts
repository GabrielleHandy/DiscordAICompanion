// src/index.ts
import express from 'express';
import { Client, GatewayIntentBits } from 'discord.js';
import { Ollama } from 'ollama';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } from '@discordjs/voice';
import say from 'say';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });
const discordClient = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates // Required for the bot to join voice channels
  ] 
});

const TARGET_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '';
const USER_ID = process.env.DISCORD_USER_ID||'';
// Clean mapping grid of safe Stardew locations for the AI Planner
const VALID_LOCATIONS = [
  { name: "Saloon", internalName: "Saloon", x: 10, y: 18, desc: "The local bar/pub. Good for socializing in evenings." },
  { name: "Town Square", internalName: "Town", x: 42, y: 55, desc: "Center of Pelican Town. Good for sunny days." },
  { name: "Archaeology House", internalName: "ArchaeologyHouse", x: 14, y: 12, desc: "The local library and museum. Good for quiet study." },
  { name: "Beach", internalName: "Beach", x: 25, y: 20, desc: "Relaxing sandy shore. Great when sunny, terrible when snowing." }
];

app.post('/api/town-override', async (req, res) => {
  const townState = req.body;
  
  // Pick one random villager to re-route this tick to save local computing performance
  const targetVillager = townState.villagers[Math.floor(Math.random() * townState.villagers.length)];
  const commandPayload: any[] = [];

  try {
    // ==========================================
    // STEP 1: THE PLANNER (Strict Game Logic via Gemma)
    // ==========================================
    const plannerPrompt = `You are the AI Overlord of Stardew Valley. You dictate villager movements.
You must return your output strictly in valid JSON format matching this exact object structure:
{
  "targetLocationName": "Internal Name of Location",
  "targetX": 0,
  "targetY": 0,
  "reasoning": "short action tag"
}

Character to move: ${targetVillager.npcName}
Current location: ${targetVillager.location} (Tile: X:${targetVillager.tileX}, Y:${targetVillager.tileY})
World Clock: ${townState.timeOfDay}, Weather: ${townState.weather}

Available target options:
${JSON.stringify(VALID_LOCATIONS, null, 2)}`;

    const plannerResponse = await ollama.generate({
      model: 'gemma2:2b', // Low-parameter model locked to strict data task
      prompt: plannerPrompt,
      format: 'json'
    });

    const plan = JSON.parse(plannerResponse.response);

// ==========================================
// STEP 2: THE TALKER (Fast Creative Voice via OpenHermes)
// ==========================================
const talkerPrompt = `
You are playing the role of ${targetVillager.npcName} from Stardew Valley.
You have just decided to leave ${targetVillager.location} and walk to the ${plan.targetLocationName} because: "${plan.reasoning}".
Current Weather: ${townState.weather}, Time: ${townState.timeOfDay}.

Write a short, highly immersive dialogue line or thought about your walk. Match your character's exact personality. Do not include any meta-text, markdown tags, or explanations—only output the direct character dialogue.
`;

const talkerResponse = await ollama.generate({
  model: 'openhermes', // Points directly to your downloaded OpenHermes model
  prompt: talkerPrompt,
  options: { 
    temperature: 0.85 // Raised slightly for awesome, creative character banter
  }
});

let speechText = talkerResponse.response.trim().replace(/^["']|["']$/g, '');

    // ==========================================
    // STEP 3: DISPATCH COORDINATES & CHAT
    // ==========================================
    commandPayload.push({
      NpcName: targetVillager.npcName,
      TargetLocationName: plan.targetLocationName,
      TargetX: plan.targetX,
      TargetY: plan.targetY
    });

    // Post to the text channel
    const channel = await discordClient.channels.fetch(TARGET_CHANNEL_ID);
    if (channel?.isTextBased()) {
      await channel.send(`🚶‍♂️ **${targetVillager.npcName}** is heading to the **${plan.targetLocationName}**: *"${speechText}"*`);
    }

    // ==========================================
    // STEP 4: THE VOICE HOOK (Local TTS Connection)
    // ==========================================
    const audioPath = path.join(__dirname, `${targetVillager.npcName}_voice.wav`);
    
    // Assign local system voices depending on who is talking
    let assignedVoice = undefined; // Uses default system voice
    if (targetVillager.npcName === "Abigail" || targetVillager.npcName === "Haley") {
      assignedVoice = "Microsoft Zira"; // Standard built-in Windows female voice
    } else if (targetVillager.npcName === "Clint" || targetVillager.npcName === "Lewis") {
      assignedVoice = "Microsoft David"; // Standard built-in Windows male voice
    }

    // Generate local audio file from the Talker's text response
    say.export(speechText, assignedVoice, 1.0, audioPath, async (err) => {
      if (err) return console.error("Voice synthesis failed:", err);

      // Search your Discord servers to find which voice channel you are sitting in
      for (const [_, guild] of discordClient.guilds.cache) {
        try {
          const member = await guild.members.fetch(USER_ID).catch(() => null);
          const voiceChannelId = member?.voice.channelId;

          if (voiceChannelId && member?.voice.channel) {
            const connection = joinVoiceChannel({
              channelId: voiceChannelId,
              guildId: guild.id,
              adapterCreator: guild.voiceAdapterCreator,
            });

            const player = createAudioPlayer();
            const resource = createAudioResource(audioPath);

            player.play(resource);
            connection.subscribe(player);

            // Once the bot finishes speaking, disconnect and clean up the file system
            player.on(AudioPlayerStatus.Idle, () => {
              connection.destroy();
              if (fs.existsSync(audioPath)) {
                fs.unlinkSync(audioPath);
              }
            });
            break; 
          }
        } catch (vErr) {
          console.error("Voice channel playback error:", vErr);
        }
      }
    });

  } catch (err) {
    console.error("Dual-model bridge issue:", err);
  }

  // Return the data directly to the awaiting C# mod stream
  res.json(commandPayload);
});

app.listen(3000, () => console.log('🚀 ACORN Dual-Model Server Online on Port 3000'));
discordClient.login(process.env.DISCORD_BOT_TOKEN);