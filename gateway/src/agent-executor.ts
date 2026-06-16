import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

interface AgentConfig {
  name: string;
  systemPrompt: string;
  model: string;
  tools?: boolean;
}

export async function executeAgent(agent: AgentConfig, prompt: string): Promise<string> {
  const model = agent.model || "gpt-4.1";
  const useTools = agent.tools !== false; // Enable tools by default
  
  try {
    if (model.includes("claude")) {
      return await executeAnthropic(agent.systemPrompt, prompt, model, useTools);
    } else if (model.includes("grok")) {
      return await executeXAI(agent.systemPrompt, prompt, model);
    } else if (model.includes("gemini")) {
      return await executeGemini(agent.systemPrompt, prompt, model);
    } else if (model.includes("kimi")) {
      return await executeKimi(agent.systemPrompt, prompt, model);
    } else if (model.includes("minimax")) {
      return await executeMiniMax(agent.systemPrompt, prompt, model);
    } else {
      return await executeOpenAI(agent.systemPrompt, prompt, model, useTools);
    }
  } catch (error) {
    console.error("Agent execution error:", error);
    return "Sorry, I encountered an error processing your request. Please try again.";
  }
}

async function executeOpenAI(systemPrompt: string, userPrompt: string, model: string, useTools: boolean = false): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt + (useTools ? "\n\nYou have access to web search. Use it when you need current information." : "") },
    { role: "user", content: userPrompt },
  ];

  const response = await client.chat.completions.create({
    model,
    messages,
    max_tokens: 1024,
    ...(useTools && { tools: TOOL_DEFINITIONS.openai }),
  });

  const message = response.choices[0]?.message;
  
  // Handle tool calls
  if (message?.tool_calls && message.tool_calls.length > 0) {
    const toolCall = message.tool_calls[0];
    const args = JSON.parse(toolCall.function.arguments);
    const toolResult = await executeTool(toolCall.function.name, args);
    
    messages.push(message);
    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: toolResult,
    });

    const finalResponse = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 1024,
    });

    return finalResponse.choices[0]?.message?.content || "No response generated.";
  }

  return message?.content || "No response generated.";
}

async function executeAnthropic(systemPrompt: string, userPrompt: string, model: string, useTools: boolean = false): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  
  // Map model names to actual API model IDs
  const modelMap: Record<string, string> = {
    "claude-sonnet-4": "claude-sonnet-4-20250514",
    "claude-opus-4": "claude-opus-4-20250514",
  };
  const actualModel = modelMap[model] || model;
  console.log(`[Anthropic] Using model: ${actualModel}`);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];

  const response = await client.messages.create({
    model: actualModel,
    max_tokens: 1024,
    system: systemPrompt + (useTools ? "\n\nYou have access to web search. Use it when you need current information." : ""),
    messages,
    ...(useTools && { tools: TOOL_DEFINITIONS.anthropic }),
  });

  // Handle tool use
  if (response.stop_reason === "tool_use") {
    const toolUseBlock = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (toolUseBlock) {
      const toolResult = await executeTool(toolUseBlock.name, toolUseBlock.input as Record<string, unknown>);
      
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUseBlock.id, content: toolResult }],
      });

      const finalResponse = await client.messages.create({
        model: actualModel,
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      });

      const finalContent = finalResponse.content[0];
      return finalContent.type === "text" ? finalContent.text : "No response generated.";
    }
  }

  const content = response.content[0];
  return content.type === "text" ? content.text : "No response generated.";
}

async function executeXAI(systemPrompt: string, userPrompt: string, model: string): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.error("[xAI] XAI_API_KEY not configured");
    throw new Error("xAI API key not configured");
  }

  // Pass model name through; strip any "clawd-xai/" prefix if present.
  // Default to grok-4-1-fast-non-reasoning (the current fast tier model).
  const strippedModel = model.replace(/^clawd-xai\//, "").replace(/^xai\//, "");
  const actualModel = strippedModel || "grok-4-1-fast-non-reasoning";
  console.log(`[xAI] Using model: ${actualModel}`);

  const baseUrl = (process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/+$/, "");

  // Grok has native web and X search. Use fetch for full control.
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: actualModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1024,
    }),
  });

  // Check response status before parsing
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[xAI] API error ${response.status}: ${errorText}`);
    throw new Error(`xAI API error: ${response.status}`);
  }

  const data = await response.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  
  if (data.error) {
    console.error("[xAI] API returned error:", data.error);
    throw new Error(data.error.message || "xAI API error");
  }
  
  return data.choices?.[0]?.message?.content || "No response generated.";
}

async function executeGemini(systemPrompt: string, userPrompt: string, model: string): Promise<string> {
  // Map model names
  const modelMap: Record<string, string> = {
    "gemini-2.0-flash": "gemini-2.0-flash",
    "gemini-3-flash": "gemini-2.0-flash", // fallback
  };
  const actualModel = modelMap[model] || "gemini-2.0-flash";
  console.log(`[Gemini] Using model: ${actualModel}`);

  // Using OpenAI-compatible endpoint for Gemini
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\nUser: ${userPrompt}` }] },
        ],
      }),
    }
  );

  const data = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
}

async function executeKimi(systemPrompt: string, userPrompt: string, model: string): Promise<string> {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    console.error("[Kimi] MOONSHOT_API_KEY not configured");
    throw new Error("Kimi API key not configured");
  }

  // Kimi K2.5 via Moonshot AI - OpenAI-compatible API
  const actualModel = model.includes("k2.5") ? "moonshot-v1-128k" : "moonshot-v1-32k";
  console.log(`[Kimi] Using model: ${actualModel}`);

  const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: actualModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Kimi] API error ${response.status}: ${errorText}`);
    throw new Error(`Kimi API error: ${response.status}`);
  }

  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content || "No response generated.";
}

async function executeMiniMax(systemPrompt: string, userPrompt: string, model: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  const groupId = process.env.MINIMAX_GROUP_ID;
  if (!apiKey || !groupId) {
    console.error("[MiniMax] MINIMAX_API_KEY or MINIMAX_GROUP_ID not configured");
    throw new Error("MiniMax API not configured");
  }

  // MiniMax ABAB 6.5
  const actualModel = model.includes("abab6.5") ? "abab6.5-chat" : "abab6-chat";
  console.log(`[MiniMax] Using model: ${actualModel}`);

  const response = await fetch(`https://api.minimax.chat/v1/text/chatcompletion_v2?GroupId=${groupId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: actualModel,
      messages: [
        { sender_type: "BOT", sender_name: "System", text: systemPrompt },
        { sender_type: "USER", sender_name: "User", text: userPrompt },
      ],
      reply_constraints: { sender_type: "BOT", sender_name: "Assistant" },
      tokens_to_generate: 1024,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[MiniMax] API error ${response.status}: ${errorText}`);
    throw new Error(`MiniMax API error: ${response.status}`);
  }

  const data = await response.json() as { reply?: string; choices?: { messages?: { text?: string }[] }[] };
  return data.reply || data.choices?.[0]?.messages?.[0]?.text || "No response generated.";
}
