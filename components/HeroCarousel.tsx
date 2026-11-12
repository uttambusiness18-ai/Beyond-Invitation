"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import Link from "@/components/NavigationLink";
import styles from "./HeroCarousel.module.css";

// Paste your four banner image links into src, in display order.
// Keep title and description in sync with the artwork: phones use live text.
const HERO_BANNERS = [
  {
    src: "https://res.cloudinary.com/dxzuvk7np/image/upload/v1794484672/WhatsApp_Image_2026-11-12_at_4.44.38_PM_zr4fz7.jpg",
    alt: "Embroidered potli bags for celebrations and gifting",
    title: "Potli Bags",
    description: "Elegant Little Bags for Every Grand Celebration",
    href: "/search?q=potli",
  },
  {
    src: "https://res.cloudinary.com/dxzuvk7np/image/upload/v1794484672/WhatsApp_Image_2026-11-12_at_5.03.39_PM_qnl9vb.jpg",
    alt: "Bengali Wedding Cards",
    title: "Bengali Cards",
    description: "A Beautiful Beginning to Your Shubho Bibaho",
    href: "/collections/wedding-card-bengali",
  },
  {
    src: "https://res.cloudinary.com/dxzuvk7np/image/upload/v1794484672/WhatsApp_Image_2026-11-12_at_5.11.30_PM_cnbajp.jpg",
    alt: "Wedding Boxes",
    title: "Wedding Box",
    description: "Beautifully Crafted to Make Every Celebration Special",
    href: "/wedding-boxes",
  },
  {
    src: "https://res.cloudinary.com/dxzuvk7np/image/upload/v1794484672/WhatsApp_Image_2026-11-12_at_5.22.16_PM_czgi3p.jpg",
    alt: "All Wedding Cards",
    title: "Wedding Card",
    description: "Beautiful Invitations for Your Beautiful Beginnings",
    href: "/wedding-cards",
  },
];

const SLIDE_INTERVAL_MS = 5000;

export default function HeroCarousel() {
  const [slide, setSlide] = useState({
    activeIndex: 0,
    previousIndex: -1,
    direction: 1,
  });
  const [isPaused, setIsPaused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);
    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (isPaused || isHovered || prefersReducedMotion) return;

    const timeout = window.setTimeout(() => {
      setSlide((previousSlide) => ({
        activeIndex: (previousSlide.activeIndex + 1) % HERO_BANNERS.length,
        previousIndex: previousSlide.activeIndex,
        direction: 1,
      }));
    }, SLIDE_INTERVAL_MS);

    return () => window.clearTimeout(timeout);
  }, [slide.activeIndex, isPaused, isHovered, prefersReducedMotion]);

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
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setIsHovered(true);
      }}
      onPointerLeave={() => setIsHovered(false)}
    >
      <h1 className="sr-only">Beyond Invitation wedding cards and gifting</h1>
      <div
        className={styles.viewport}
        aria-live={isPaused || prefersReducedMotion ? "polite" : "off"}
        style={{ "--slide-direction": slide.direction } as CSSProperties}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStart.current = event.touches.length === 1 && touch
            ? { x: touch.clientX, y: touch.clientY }
            : null;
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          const touch = event.changedTouches[0];
          if (!start || !touch) return;
          const deltaX = touch.clientX - start.x;
          const deltaY = touch.clientY - start.y;
          if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;
          setIsPaused(true);
          const direction = deltaX < 0 ? 1 : -1;
          showSlide(slide.activeIndex + direction, direction);
        }}
        onTouchCancel={() => { touchStart.current = null; }}
      >
        {HERO_BANNERS.map((banner, index) => (
          <div
            key={index}
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${HERO_BANNERS.length}`}
            aria-hidden={index !== slide.activeIndex}
            inert={index !== slide.activeIndex}
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
            <div className={styles.mobileContent}>
              <h2 className={styles.mobileTitle}>{banner.title}</h2>
              <p className={styles.mobileDescription}>{banner.description}</p>
              {banner.src && (
                <div className={styles.mobileArtworkRow} aria-hidden="true">
                  {(["left", "right"] as const).map((side) => (
                    <div key={side} className={styles.mobileArtwork}>
                      <Image
                        src={banner.src}
                        alt=""
                        fill
                        sizes="160px"
                        priority={index === 0}
                        loading={index === 0 ? undefined : "eager"}
                        unoptimized
                        className={`${styles.artworkImage} ${side === "left" ? styles.artworkLeft : styles.artworkRight}`}
                      />
                    </div>
                  ))}
                </div>
              )}
              <Link
                href={banner.href}
                className={styles.mobileCta}
                tabIndex={index === slide.activeIndex ? 0 : -1}
                aria-label={`Shop ${banner.title}`}
                onFocus={() => setIsPaused(true)}
              >
                Shop now <ChevronRight size={18} aria-hidden="true" />
              </Link>
            </div>
            {index === slide.activeIndex && (
              <Link
                href={banner.href}
                aria-label={`Shop ${banner.alt}`}
                className={styles.bannerLink}
                onFocus={() => setIsPaused(true)}
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
          onFocus={() => setIsPaused(true)}
          onClick={() => { setIsPaused(true); showSlide(slide.activeIndex - 1, -1); }}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>

        <div className={styles.dots} role="group" aria-label="Choose a banner">
          {HERO_BANNERS.map((banner, index) => (
            <button
              key={index}
              type="button"
              className={styles.dotButton}
              aria-label={`Show ${banner.title.toLowerCase()}`}
              aria-current={index === slide.activeIndex ? "true" : undefined}
              onFocus={() => setIsPaused(true)}
              onClick={() => {
                setIsPaused(true);
                showSlide(index, index > slide.activeIndex ? 1 : -1);
              }}
            >
              <span className={styles.dot} />
            </button>
          ))}
        </div>

        <button
          type="button"
          className={styles.controlButton}
          aria-label="Next banner"
          onFocus={() => setIsPaused(true)}
          onClick={() => { setIsPaused(true); showSlide(slide.activeIndex + 1, 1); }}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
        {!prefersReducedMotion && (
          <button
            type="button"
            className={styles.controlButton}
            aria-label={isPaused ? "Resume slideshow" : "Pause slideshow"}
            onClick={() => setIsPaused((paused) => !paused)}
          >
            {isPaused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          </button>
        )}
      </div>
    </section>
  );
}
