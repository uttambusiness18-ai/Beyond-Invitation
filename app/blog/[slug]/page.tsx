import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Poppins } from "next/font/google";
import { ChevronRight, Clock3 } from "lucide-react";
import { getPublishedBlog, getPublishedBlogs } from "@/lib/blog-server";
import { blogDate } from "@/lib/blog";
import { getSiteUrl } from "@/lib/site-config";
import { absoluteUrl } from "@/lib/seo";
import JsonLd from "@/components/seo/JsonLd";
import BlogMarkdown from "@/components/blog/BlogMarkdown";
import BlogImage from "@/components/blog/BlogImage";
import BlogShare from "@/components/blog/BlogShare";
import styles from "@/components/blog/Article.module.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPublishedBlog((await params).slug);
  if (!post)
    return {
      title: "Story not found",
      robots: { index: false, follow: false },
    };
  const images = post.cover_image
    ? [{ url: absoluteUrl(post.cover_image)!, alt: post.cover_alt }]
    : undefined;
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      url: `/blog/${post.slug}`,
      type: "article",
      publishedTime: post.published_at || undefined,
      modifiedTime: post.updated_at,
      authors: [post.author],
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
      images,
    },
  };
}
export default async function ArticlePage({ params }: Props) {
  const post = await getPublishedBlog((await params).slug);
  if (!post) notFound();
  const related = (await getPublishedBlogs().catch(() => []))
    .filter((item) => item.id !== post.id)
    .sort(
      (a, b) =>
        Number(b.category === post.category) -
        Number(a.category === post.category),
    )
    .slice(0, 4);
  return (
    <div className={`${styles.page} ${poppins.className}`}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.excerpt,
          image: absoluteUrl(post.cover_image),
          datePublished: post.published_at,
          dateModified: post.updated_at,
          author: {
            "@type":
              post.author === "Beyond Invitation" ? "Organization" : "Person",
            name: post.author,
          },
          publisher: {
            "@type": "Organization",
            name: "Beyond Invitation",
            logo: { "@type": "ImageObject", url: `${getSiteUrl()}/logo.png` },
          },
          mainEntityOfPage: `${getSiteUrl()}/blog/${post.slug}`,
        }}
      />
      <div className={styles.layout}>
        <article className={styles.article}>
          <header className={styles.hero}>
            <div className={styles.cover}>
              <BlogImage src={post.cover_image} alt={post.cover_alt} priority />
            </div>
            <div className={styles.heroContent}>
              <nav className={styles.breadcrumb} aria-label="Breadcrumb">
                <Link href="/">Home</Link>
                <ChevronRight size={12} aria-hidden="true" />
                <Link href="/blog">Blog</Link>
                <ChevronRight size={12} aria-hidden="true" />
                <span className={styles.category}>{post.category}</span>
              </nav>
              <h1>{post.title}</h1>
              <div className={styles.heroMeta}>
                <div className={styles.author}>
                  <div className={styles.byline}>
                    <span>{post.author}</span>
                    <time dateTime={post.published_at || undefined}>
                      {blogDate(post.published_at)}
                    </time>
                  </div>
                </div>
                <span className={styles.readingTime}>
                  <Clock3 size={13} aria-hidden="true" />
                  {post.reading_minutes} min read
                </span>
              </div>
            </div>
          </header>
          <div className={styles.contentPanel}>
            <div className={styles.shareRail}>
              <BlogShare />
            </div>
            <div className={styles.articleBody}>
              <BlogMarkdown content={post.content} />
              <footer className={styles.articleEnd}>
                <span>
                  Written by <strong>{post.author}</strong>
                </span>
                <Link href="/blog">Back to all stories</Link>
              </footer>
            </div>
          </div>
        </article>
        <aside
          className={styles.recommended}
          aria-labelledby="recommended-heading"
        >
          <div className={styles.recommendedHeading}>
            <h2 id="recommended-heading">Recommended</h2>
            <Link href="/blog">View All</Link>
          </div>
          {related.length ? (
            <ul className={styles.recommendedList}>
              {related.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/blog/${item.slug}`}
                    className={styles.recommendedLink}
                  >
                    <div className={styles.thumbnail}>
                      <BlogImage src={item.cover_image} alt="" />
                    </div>
                    <div className={styles.recommendedContent}>
                      <h3>{item.title}</h3>
                      <div className={styles.recommendedMeta}>
                        <span>{item.author}</span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={item.published_at || undefined}>
                          {blogDate(item.published_at)}
                        </time>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyRecommendations}>
              More stories are on the way. Explore{" "}
              <Link href="/blog">the journal</Link> for wedding inspiration.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
