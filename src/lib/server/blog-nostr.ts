import { getCollection } from "astro:content";
import { AppError } from "./errors";
import type { BlogPostNip23Command } from "./nostr-types";

function normalizeSlug(value: string | undefined): string {
  const slug = value?.trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]{3,120}$/.test(slug)) {
    throw new AppError("Neplatný slug textu", {
      code: "INVALID_BLOG_SLUG",
      status: 400,
      expose: true,
    });
  }

  return slug;
}

export async function getBlogPostNip23Command(slugValue: string | undefined, requestUrl?: string): Promise<BlogPostNip23Command> {
  const slug = normalizeSlug(slugValue);
  const posts = await getCollection("blog", ({ data }) => !data.draft);
  const post = posts.find((entry) => entry.id === slug);
  if (!post) {
    throw new AppError("Text nenalezen", {
      code: "BLOG_POST_NOT_FOUND",
      status: 404,
      expose: true,
    });
  }

  const content = "body" in post && typeof post.body === "string" ? post.body.trim() : "";
  if (!content) {
    throw new AppError("Text nemá publikovatelný Markdown obsah", {
      code: "BLOG_POST_EMPTY",
      status: 422,
      expose: true,
    });
  }

  return {
    slug: post.id,
    title: post.data.title,
    summary: post.data.description,
    content,
    publishedAt: post.data.publishedAt,
    updatedAt: post.data.updatedAt,
    tags: post.data.tags,
    url: requestUrl ? new URL(`/blog/${post.id}`, requestUrl).toString() : undefined,
  };
}
