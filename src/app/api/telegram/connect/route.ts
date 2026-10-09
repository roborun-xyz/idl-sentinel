import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { generateConnectionToken } from "@/lib/telegram/connection-tokens";

/**
 * Generate a Telegram connection token for the authenticated user
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;

    if (!botToken || !botUsername) {
      return NextResponse.json(
        { error: "Telegram bot not configured. Please contact the administrator." },
        { status: 500 }
      );
    }

    // Generate a connection token
    const token = await generateConnectionToken(user.userId);

    // Create the Telegram deep link
    const telegramUrl = `https://t.me/${botUsername}?start=${token}`;

    return NextResponse.json({
      token,
      telegramUrl,
      expiresIn: 600, // 10 minutes in seconds
    });
  } catch (error) {
    console.error("Error generating Telegram connection token:", error);
    return NextResponse.json({ error: "Failed to generate connection token" }, { status: 500 });
  }
}
