/**
 * channel-config.ts
 *
 * Single source of truth for all OpenClaw channel integrations.
 * Maps channel identifiers → credential field definitions + openclaw.json shapes.
 *
 * OpenClaw supports 17 channels. We surface all of them.
 * Auth types:
 *   "token"   — user provides one or more API tokens/secrets
 *   "qr"      — QR code scan (WhatsApp, Signal) — separate pairing flow
 *   "oauth"   — OAuth flow (Google Chat, iMessage bridge)
 *   "local"   — requires local software on user machine, can't self-serve
 */

export type AuthType = "token" | "qr" | "oauth" | "local";
export type FieldType = "text" | "password" | "url" | "tel" | "textarea";

export interface ChannelField {
  id:          string;
  label:       string;
  type:        FieldType;
  required:    boolean;
  hint?:       string;
  placeholder?: string;
}

export interface ChannelMeta {
  id:          string;           // matches OpenClaw channel key
  name:        string;           // display name
  icon:        string;           // emoji
  authType:    AuthType;
  wave:        1 | 2;            // 1 = available now, 2 = coming soon
  fields:      ChannelField[];
  description: string;
  setupUrl?:   string;           // link to set up credentials (BotFather etc.)
}

export const CHANNELS: ChannelMeta[] = [
  // ── Wave 1: Token-based, available now ──────────────────────────────────────
  {
    id: "telegram",
    name: "Telegram",
    icon: "✈️",
    authType: "token",
    wave: 1,
    description: "Deploy as a Telegram bot. DMs and group chats.",
    setupUrl: "https://t.me/BotFather",
    fields: [
      {
        id: "botToken",
        label: "Bot Token",
        type: "password",
        required: true,
        hint: "From @BotFather → /newbot",
        placeholder: "1234567890:ABCdef...",
      },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    icon: "🎮",
    authType: "token",
    wave: 1,
    description: "Deploy as a Discord bot. Servers, DMs, threads.",
    setupUrl: "https://discord.com/developers/applications",
    fields: [
      {
        id: "token",
        label: "Bot Token",
        type: "password",
        required: true,
        hint: "Discord Developer Portal → Bot → Reset Token",
        placeholder: "MTIzN...",
      },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    icon: "💬",
    authType: "token",
    wave: 1,
    description: "Deploy as a Slack app. Channels, DMs, threads.",
    setupUrl: "https://api.slack.com/apps",
    fields: [
      {
        id: "appToken",
        label: "App-Level Token",
        type: "password",
        required: true,
        hint: "Slack app settings → Basic Information → App-Level Tokens (xapp-...)",
        placeholder: "xapp-1-...",
      },
      {
        id: "botToken",
        label: "Bot Token",
        type: "password",
        required: true,
        hint: "OAuth & Permissions → Bot User OAuth Token (xoxb-...)",
        placeholder: "xoxb-...",
      },
      {
        id: "signingSecret",
        label: "Signing Secret",
        type: "password",
        required: true,
        hint: "Basic Information → App Credentials → Signing Secret",
      },
    ],
  },
  {
    id: "mattermost",
    name: "Mattermost",
    icon: "🧱",
    authType: "token",
    wave: 1,
    description: "Self-hosted team messaging. Channels and DMs.",
    fields: [
      {
        id: "url",
        label: "Server URL",
        type: "url",
        required: true,
        placeholder: "https://mattermost.yourcompany.com",
      },
      {
        id: "token",
        label: "Bot Token",
        type: "password",
        required: true,
        hint: "System Console → Integrations → Bot Accounts",
      },
    ],
  },
  {
    id: "matrix",
    name: "Matrix",
    icon: "🔷",
    authType: "token",
    wave: 1,
    description: "Federated open messaging. Any Matrix homeserver.",
    setupUrl: "https://matrix.org",
    fields: [
      {
        id: "homeserver",
        label: "Homeserver URL",
        type: "url",
        required: true,
        placeholder: "https://matrix.org",
      },
      {
        id: "userId",
        label: "User ID",
        type: "text",
        required: true,
        placeholder: "@mybot:matrix.org",
      },
      {
        id: "accessToken",
        label: "Access Token",
        type: "password",
        required: true,
        hint: "Element → Settings → Help & About → Access Token",
      },
    ],
  },
  {
    id: "irc",
    name: "IRC",
    icon: "📡",
    authType: "token",
    wave: 1,
    description: "Classic IRC. Channels and private messages.",
    fields: [
      {
        id: "host",
        label: "Server Host",
        type: "text",
        required: true,
        placeholder: "irc.libera.chat",
      },
      {
        id: "port",
        label: "Port",
        type: "text",
        required: false,
        placeholder: "6667",
      },
      {
        id: "nick",
        label: "Nickname",
        type: "text",
        required: true,
        placeholder: "myagentbot",
      },
      {
        id: "password",
        label: "NickServ Password",
        type: "password",
        required: false,
      },
      {
        id: "channels",
        label: "Channels to Join",
        type: "text",
        required: false,
        placeholder: "#mychannel,#another",
      },
    ],
  },
  {
    id: "twitch",
    name: "Twitch",
    icon: "🟣",
    authType: "token",
    wave: 1,
    description: "Live in Twitch chat. Respond to commands and viewers.",
    setupUrl: "https://twitchapps.com/tmi/",
    fields: [
      {
        id: "username",
        label: "Bot Username",
        type: "text",
        required: true,
        placeholder: "myagentbot",
      },
      {
        id: "token",
        label: "OAuth Token",
        type: "password",
        required: true,
        hint: "twitchapps.com/tmi generates an oauth: token",
        placeholder: "oauth:abc123...",
      },
      {
        id: "channel",
        label: "Stream Channel",
        type: "text",
        required: true,
        hint: "Channel name to join (your Twitch username)",
        placeholder: "streamername",
      },
    ],
  },
  {
    id: "nostr",
    name: "Nostr",
    icon: "🌐",
    authType: "token",
    wave: 1,
    description: "Decentralized social protocol. DMs via Nostr relays.",
    fields: [
      {
        id: "privateKey",
        label: "Private Key (nsec or hex)",
        type: "password",
        required: true,
        hint: "The agent's Nostr private key. Keep this secret.",
        placeholder: "nsec1... or 64-char hex",
      },
      {
        id: "relays",
        label: "Relay URLs",
        type: "textarea",
        required: false,
        hint: "One relay per line. Defaults to wss://relay.damus.io",
        placeholder: "wss://relay.damus.io\nwss://nos.lol",
      },
    ],
  },
  {
    id: "feishu",
    name: "Feishu / Lark",
    icon: "🪶",
    authType: "token",
    wave: 1,
    description: "ByteDance team messaging. Popular in Asia.",
    setupUrl: "https://open.feishu.cn/app",
    fields: [
      {
        id: "appId",
        label: "App ID",
        type: "text",
        required: true,
        placeholder: "cli_...",
      },
      {
        id: "appSecret",
        label: "App Secret",
        type: "password",
        required: true,
      },
    ],
  },
  {
    id: "line",
    name: "LINE",
    icon: "💚",
    authType: "token",
    wave: 1,
    description: "Dominant messaging app in Japan, Taiwan, Thailand.",
    setupUrl: "https://developers.line.biz/console/",
    fields: [
      {
        id: "channelAccessToken",
        label: "Channel Access Token",
        type: "password",
        required: true,
        hint: "LINE Developers Console → Messaging API → Channel access token",
      },
      {
        id: "channelSecret",
        label: "Channel Secret",
        type: "password",
        required: true,
        hint: "LINE Developers Console → Basic settings → Channel secret",
      },
    ],
  },
  {
    id: "msteams",
    name: "Microsoft Teams",
    icon: "🟦",
    authType: "token",
    wave: 1,
    description: "Enterprise messaging. Teams channels and DMs.",
    setupUrl: "https://dev.teams.microsoft.com/",
    fields: [
      {
        id: "appId",
        label: "App ID",
        type: "text",
        required: true,
        hint: "Azure Bot Service → Settings → Microsoft App ID",
      },
      {
        id: "appPassword",
        label: "App Password",
        type: "password",
        required: true,
        hint: "Azure Bot Service → Settings → Client secrets",
      },
      {
        id: "tenantId",
        label: "Tenant ID (optional)",
        type: "text",
        required: false,
        hint: "Leave blank for multi-tenant bots",
      },
    ],
  },
  {
    id: "googlechat",
    name: "Google Chat",
    icon: "💬",
    authType: "token",
    wave: 1,
    description: "Google Workspace messaging. Spaces and DMs.",
    setupUrl: "https://console.cloud.google.com/",
    fields: [
      {
        id: "serviceAccountJson",
        label: "Service Account JSON",
        type: "textarea",
        required: true,
        hint: "Paste the full service account JSON from Google Cloud Console",
        placeholder: '{"type":"service_account","project_id":"..."}',
      },
    ],
  },
  {
    id: "nextcloud-talk",
    name: "Nextcloud Talk",
    icon: "☁️",
    authType: "token",
    wave: 1,
    description: "Self-hosted Nextcloud video/chat rooms.",
    fields: [
      {
        id: "url",
        label: "Nextcloud URL",
        type: "url",
        required: true,
        placeholder: "https://cloud.yourcompany.com",
      },
      {
        id: "username",
        label: "Username",
        type: "text",
        required: true,
      },
      {
        id: "password",
        label: "Password / App Token",
        type: "password",
        required: true,
        hint: "Use an app password from Settings → Security",
      },
    ],
  },
  {
    id: "zalo",
    name: "Zalo",
    icon: "🔵",
    authType: "token",
    wave: 1,
    description: "Vietnam's leading messaging platform.",
    setupUrl: "https://developers.zalo.me/",
    fields: [
      {
        id: "accessToken",
        label: "Official Account Access Token",
        type: "password",
        required: true,
        hint: "Zalo Developers → Official Account → Access Token",
      },
    ],
  },

  // ── Wave 2: QR/phone pairing — separate flow needed ─────────────────────────
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: "💬",
    authType: "qr",
    wave: 2,
    description: "2B+ users. Requires QR code scan from your phone.",
    fields: [],
  },
  {
    id: "signal",
    name: "Signal",
    icon: "🔒",
    authType: "qr",
    wave: 2,
    description: "End-to-end encrypted. Requires phone pairing.",
    fields: [
      {
        id: "phoneNumber",
        label: "Phone Number",
        type: "tel",
        required: true,
        placeholder: "+1234567890",
      },
    ],
  },
  {
    id: "imessage",
    name: "iMessage",
    icon: "💬",
    authType: "local",
    wave: 2,
    description: "Apple iMessage. Requires a Mac running BlueBubbles.",
    setupUrl: "https://bluebubbles.app/",
    fields: [],
  },
];

// ── Channel lookup helpers ────────────────────────────────────────────────────

export const CHANNEL_MAP = Object.fromEntries(
  CHANNELS.map((c) => [c.id, c])
) as Record<string, ChannelMeta>;

export const WAVE1_CHANNELS = CHANNELS.filter((c) => c.wave === 1);
export const WAVE2_CHANNELS = CHANNELS.filter((c) => c.wave === 2);

export function isSupported(channel: string): boolean {
  return channel in CHANNEL_MAP;
}

export function isSelfServable(channel: string): boolean {
  const meta = CHANNEL_MAP[channel];
  return !!meta && meta.authType === "token" && meta.wave === 1;
}

// ── Credential validation ─────────────────────────────────────────────────────

export function validateCredentials(
  channel: string,
  credentials: Record<string, string>
): string | null {
  const meta = CHANNEL_MAP[channel];
  if (!meta) return `Unknown channel: ${channel}`;

  for (const field of meta.fields) {
    if (field.required && !credentials[field.id]?.trim()) {
      return `Missing required field: ${field.label}`;
    }
  }
  return null; // valid
}

// ── OpenClaw config shape per channel ────────────────────────────────────────

export function buildOpenClawConfig(
  channel: string,
  credentials: Record<string, string>
): Record<string, unknown> {
  switch (channel) {
    case "telegram":
      return {
        botToken:   credentials.botToken,
        streamMode: "partial",
        draftChunk: { minChars: 200, maxChars: 800 },
      };

    case "discord":
      return {
        token:              credentials.token,
        maxLinesPerMessage: 17,
        blockStreaming:     false,
      };

    case "slack":
      return {
        appToken:      credentials.appToken,
        botToken:      credentials.botToken,
        signingSecret: credentials.signingSecret,
      };

    case "mattermost":
      return {
        url:   credentials.url,
        token: credentials.token,
      };

    case "matrix":
      return {
        homeserver:  credentials.homeserver,
        userId:      credentials.userId,
        accessToken: credentials.accessToken,
      };

    case "irc": {
      const config: Record<string, unknown> = {
        host: credentials.host,
        port: parseInt(credentials.port || "6667", 10),
        nick: credentials.nick,
      };
      if (credentials.password)  config.password = credentials.password;
      if (credentials.channels)  config.autoJoin  = credentials.channels.split(",").map((c) => c.trim());
      return config;
    }

    case "twitch":
      return {
        username: credentials.username,
        token:    credentials.token,
        channel:  credentials.channel,
      };

    case "nostr": {
      const cfg: Record<string, unknown> = { privateKey: credentials.privateKey };
      if (credentials.relays) {
        cfg.relays = credentials.relays.split("\n").map((r) => r.trim()).filter(Boolean);
      }
      return cfg;
    }

    case "feishu":
      return {
        appId:     credentials.appId,
        appSecret: credentials.appSecret,
      };

    case "line":
      return {
        channelAccessToken: credentials.channelAccessToken,
        channelSecret:      credentials.channelSecret,
      };

    case "msteams": {
      const cfg: Record<string, unknown> = {
        appId:       credentials.appId,
        appPassword: credentials.appPassword,
      };
      if (credentials.tenantId) cfg.tenantId = credentials.tenantId;
      return cfg;
    }

    case "googlechat":
      return {
        serviceAccountJson: credentials.serviceAccountJson,
      };

    case "nextcloud-talk":
      return {
        url:      credentials.url,
        username: credentials.username,
        password: credentials.password,
      };

    case "zalo":
      return {
        accessToken: credentials.accessToken,
      };

    case "whatsapp":
      return {
        accounts: { default: { authDir: "/home/node/.openclaw/wa-auth" } },
        dmPolicy: "open",
      };

    case "signal":
      return {
        phoneNumber: credentials.phoneNumber,
      };

    default:
      // Pass through for channels we don't have explicit mappings for
      return { ...credentials };
  }
}
