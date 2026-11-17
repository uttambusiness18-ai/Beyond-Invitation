import styles from "./HeroVideo.module.css";

const HERO_VIDEO_URL =
  "https://res.cloudinary.com/dhbevwau9/video/upload/v1794907952/trai_version_3_dhaw8n.mp4";

export default function HeroVideo() {
  return (
    <section
      aria-label="Beyond Invitation"
      data-no-text-motion
      className={styles.hero}
    >
      <h1 className="sr-only">Beyond Invitation wedding cards and gifting</h1>
      <video
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
    </section>
  );
}
