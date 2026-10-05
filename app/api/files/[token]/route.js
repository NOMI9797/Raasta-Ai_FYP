import { Readable } from "stream";
import { NextResponse } from "next/server";
import { verifySignedToken, getObjectStream, contentDisposition, parseRange } from "@/libs/hiring/storage";

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
    let object = await getObjectStream(key);
    // Recordings are played in <video>/<audio>, which seek with Range requests
    const requested = parseRange(request.headers.get("range"), object.size);
    if (requested === "unsatisfiable") {
      object.stream?.destroy?.();
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${object.size}` } });
    }
    if (requested) {
      object.stream?.destroy?.();
      object = await getObjectStream(key, { range: requested });
    }
    const { stream, contentType, size, range } = object;
    const headers = {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
      "Content-Disposition": contentDisposition(filename || key.split("/").pop()),
    };
    if (range) {
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
      headers["Content-Length"] = String(range.end - range.start + 1);
    } else if (size != null) {
      headers["Content-Length"] = String(size);
    }
    const body = typeof stream?.pipe === "function" ? Readable.toWeb(stream) : stream;
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    if (error?.code === "not_found") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    console.error("File download error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
