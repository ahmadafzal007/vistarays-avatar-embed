import { NextResponse } from "next/server";
import { connectDB, hasMongo } from "@/lib/mongodb";
import { Conversation } from "@/lib/models";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { memberName, messages } = body;

    if (!memberName || !messages) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Transcript logging is optional — without MongoDB the card still works.
    if (!hasMongo()) {
      return NextResponse.json({ success: true, skipped: "MONGODB_URL not configured" });
    }

    await connectDB();

    const doc = new Conversation({
      memberName,
      messages,
    });

    await doc.save();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save conversation:", error);
    return NextResponse.json({ error: "Failed to save conversation" }, { status: 500 });
  }
}
