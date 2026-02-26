import { NextResponse } from "next/server";
import { buildGithubHeaders, githubApi, parseGithubUrl } from "@/lib/github";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { url, paths, token } = await request.json();
  const repoInfo = parseGithubUrl(url);

  if (!repoInfo || !Array.isArray(paths)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const headers = buildGithubHeaders(token);
    const contents: Record<string, string> = {};
    const errors: Record<string, string> = {};

    await Promise.all(
      paths.map(async (filePath: string) => {
        try {
          const encodedPath = String(filePath)
            .split("/")
            .map((part) => encodeURIComponent(part))
            .join("/");
          const response = await githubApi.get(
            `/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}`,
            { headers },
          );

          if (response.data.content && response.data.encoding === "base64") {
            contents[filePath] = Buffer.from(response.data.content, "base64").toString("utf-8");
          } else {
            contents[filePath] = "";
            errors[filePath] = "Could not retrieve content or content is too large";
          }
        } catch (error) {
          console.error(`Failed to fetch ${filePath}`, error);
          contents[filePath] = "";
          const status = (error as any)?.response?.status;
          const message =
            (error as any)?.response?.data?.message ||
            (error as any)?.message ||
            "Failed to fetch file";
          errors[filePath] = status ? `${status}: ${message}` : message;
        }
      }),
    );

    return NextResponse.json({ contents, errors });
  } catch (error: any) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || error.message;
    return NextResponse.json({ error: message }, { status });
  }
}
