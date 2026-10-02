import { Readable } from "stream";
import { NextResponse } from "next/server";
import { verifySignedToken, getObjectStream, contentDisposition } from "@/libs/hiring/storage";

export const dynamic = "force-dynamic";

// GET /api/files/[token] — serves a stored file for a valid signed token (local storage driver).
// The token is the authorisation: it names one key and expires within minutes.
export async function GET(request, { params }) {
  let key;
  let filename;
  try {
    ({ key, filename } = verifySignedToken(params.token));
  } catch (error) {
    if (error?.code === "config") {
      console.error("File link error:", error.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({ error: "This link is invalid or has expired" }, { status: 404 });
  }

  try {
    const { stream, contentType, size } = await getObjectStream(key);
    const headers = {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": contentDisposition(filename || key.split("/").pop()),
    };
    if (size != null) headers["Content-Length"] = String(size);
    const body = typeof stream?.pipe === "function" ? Readable.toWeb(stream) : stream;
    return new Response(body, { headers });
  } catch (error) {
    if (error?.code === "not_found") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    console.error("File download error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
