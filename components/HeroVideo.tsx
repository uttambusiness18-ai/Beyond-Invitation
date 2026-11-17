"use client";

import { useEffect, useRef } from "react";
import styles from "./HeroVideo.module.css";

const HERO_VIDEO_URL =
  "https://res.cloudinary.com/dhbevwau9/video/upload/v1794911406/trai_version_4_ymh2mv.mp4";
const OVERLAY_START_SECONDS = 5;
const OVERLAY_DURATION_SECONDS = 18;

export default function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;
    let frame: number | null = null;

    // Drive the paused CSS animations from playback time, so buffering, seeking
    // and looping preserve the five-second delay and 18-second display window.
    const update = () => {
      const time = Math.max(0, video.currentTime - OVERLAY_START_SECONDS);
      overlay.hidden = video.currentTime < OVERLAY_START_SECONDS || time >= OVERLAY_DURATION_SECONDS;
      overlay.style.setProperty("--overlay-time", `${-Math.min(time, OVERLAY_DURATION_SECONDS)}s`);
    };
    const tick = () => {
      frame = null;
      update();
      if (!video.paused && !video.ended && video.currentTime < OVERLAY_START_SECONDS + OVERLAY_DURATION_SECONDS) {
        frame = window.requestAnimationFrame(tick);
      }
    };
    const sync = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      tick();
    };
    const events = ["playing", "pause", "seeking", "seeked", "timeupdate", "loadedmetadata", "ended"];
    events.forEach((event) => video.addEventListener(event, sync));
    sync();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      events.forEach((event) => video.removeEventListener(event, sync));
    };
  }, []);

  return (
    <section
      aria-label="Beyond Invitation"
      data-no-text-motion
      className={styles.hero}
    >
      <h1 className="sr-only">Beyond Invitation wedding cards and gifting</h1>
      <video
        ref={videoRef}
        className={styles.video}
        src={HERO_VIDEO_URL}
        width={1284}
        height={724}
        autoPlay
        muted
        loop
        playsInline
        controls={false}
        controlsList="nodownload nofullscreen noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        preload="auto"
        tabIndex={-1}
        aria-hidden="true"
      />
      <div ref={overlayRef} className={styles.overlay} hidden>
        <p className={styles.headline}>
          <span className={styles.line}>Beautifully crafted to make{" "}</span>
          <span className={`${styles.line} ${styles.lastLine}`}>every celebration special</span>
        </p>
      </div>
    </section>
  );
}
