"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "@/components/NavigationLink";
import styles from "./HeroCarousel.module.css";

// Paste your four banner image links into src, in display order.
// Update each alt with a description of that banner. Empty links show placeholders.
const HERO_BANNERS = [
  { src: "https://res.cloudinary.com/dxzuvk7np/image/upload/v1794484672/WhatsApp_Image_2026-11-12_at_4.44.38_PM_zr4fz7.jpg", alt: "Hero banner 1" },
  { src: "https://res.cloudinary.com/dxzuvk7np/image/upload/v1794484672/WhatsApp_Image_2026-11-12_at_5.03.39_PM_qnl9vb.jpg", alt: "Bengali Wedding Cards", href: "/collections/wedding-card-bengali" },
  { src: "https://res.cloudinary.com/dxzuvk7np/image/upload/v1794484672/WhatsApp_Image_2026-11-12_at_5.11.30_PM_cnbajp.jpg", alt: "Wedding Boxes", href: "/wedding-boxes" },
  { src: "https://res.cloudinary.com/dxzuvk7np/image/upload/v1794484672/WhatsApp_Image_2026-11-12_at_5.22.16_PM_czgi3p.jpg", alt: "All Wedding Cards", href: "/wedding-cards" },
];

const SLIDE_INTERVAL_MS = 5000;

export default function HeroCarousel() {
  const [slide, setSlide] = useState({
    activeIndex: 0,
    previousIndex: -1,
    direction: 1,
  });
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSlide((previousSlide) => ({
        activeIndex: (previousSlide.activeIndex + 1) % HERO_BANNERS.length,
        previousIndex: previousSlide.activeIndex,
        direction: 1,
      }));
    }, SLIDE_INTERVAL_MS);

    return () => window.clearTimeout(timeout);
  }, [slide.activeIndex]);

  function showSlide(index: number, direction: number) {
    const nextIndex = (index + HERO_BANNERS.length) % HERO_BANNERS.length;
    if (nextIndex === slide.activeIndex) return;

    setSlide({
      activeIndex: nextIndex,
      previousIndex: slide.activeIndex,
      direction,
    });
  }

  return (
    <section
      aria-label="Featured collections"
      aria-roledescription="carousel"
      data-no-text-motion
      className={styles.hero}
    >
      <h1 className="sr-only">Beyond Invitation wedding cards and gifting</h1>
      <div
        className={styles.viewport}
        aria-live="off"
        style={{ "--slide-direction": slide.direction } as CSSProperties}
      >
        {HERO_BANNERS.map((banner, index) => (
          <div
            key={index}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${HERO_BANNERS.length}`}
            aria-hidden={index !== slide.activeIndex}
            className={`${styles.slide} ${
              index === slide.activeIndex
                ? styles.active
                : index === slide.previousIndex
                  ? styles.outgoing
                  : ""
            } ${slide.previousIndex === -1 ? styles.initial : ""}`}
          >
            {banner.src ? (
              <Image
                src={banner.src}
                alt={banner.alt}
                width={1600}
                height={500}
                sizes="100vw"
                priority={index === 0}
                loading={index === 0 ? undefined : "eager"}
                unoptimized
                className={styles.image}
              />
            ) : (
              <div className={styles.placeholder}>{banner.alt}</div>
            )}
            {banner.href && index === slide.activeIndex && (
              <Link
                href={banner.href}
                aria-label={`Shop ${banner.alt}`}
                className={styles.bannerLink}
              />
            )}
          </div>
        ))}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.controlButton}
          aria-label="Previous banner"
          onClick={() => showSlide(slide.activeIndex - 1, -1)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>

        <div className={styles.dots} role="group" aria-label="Choose a banner">
          {HERO_BANNERS.map((banner, index) => (
            <button
              key={index}
              type="button"
              className={styles.dotButton}
              aria-label={`Show ${banner.alt.toLowerCase()}`}
              aria-current={index === slide.activeIndex ? "true" : undefined}
              onClick={() =>
                showSlide(index, index > slide.activeIndex ? 1 : -1)
              }
            >
              <span className={styles.dot} />
            </button>
          ))}
        </div>

        <button
          type="button"
          className={styles.controlButton}
          aria-label="Next banner"
          onClick={() => showSlide(slide.activeIndex + 1, 1)}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
