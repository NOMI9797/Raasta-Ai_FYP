import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { addDocument } from "@/libs/sales/knowledge/store";
import { extractFileText, validateKbFile } from "@/libs/sales/knowledge/extract";
import { knowledgeFail as fail } from "@/libs/sales/knowledge/http";

// POST /api/sales/knowledge/upload (multipart: file, category, title?) — add a PDF, DOCX, TXT or Markdown file
export const POST = withAuth(async (request, { user }) => {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "Choose a file" }, { status: 400 });
    const invalid = validateKbFile({ filename: file.name, size: file.size });
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const content = await extractFileText({ buffer: Buffer.from(await file.arrayBuffer()), filename: file.name });
    if (content.length < 20) return NextResponse.json({ error: "Couldn't read any text in that file (a scanned PDF has no text)" }, { status: 400 });
    const title = String(form.get("title") || "").trim() || file.name.replace(/\.[^.]+$/, "");
    const document = await addDocument({ userId: user.id, title, category: form.get("category"), content, kind: "file", source: file.name });
    return NextResponse.json({ success: true, document });
  } catch (error) {
    return fail(error, "Could not add the file");
  }
}, { requireUser: true });
