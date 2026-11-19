"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import Link from "@/components/NavigationLink";
import { faqItems } from "@/lib/faq";
import styles from "./FaqPage.module.css";

export default function FaqBrowser() {
  const [openIds, setOpenIds] = useState(
    () => new Set(faqItems[0] ? [faqItems[0].id] : []),
  );

  function toggleQuestion(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className={styles.container} aria-labelledby="faq-title">
      <h1 id="faq-title" className={styles.pageTitle}>
        Frequently asked questions
      </h1>
      <div className={styles.answers}>
        {faqItems.map((item) => (
          <details
            key={item.id}
            open={openIds.has(item.id)}
            className={styles.question}
          >
            <summary
              onClick={(event) => {
                event.preventDefault();
                toggleQuestion(item.id);
              }}
            >
              <h2>{item.question}</h2>
              <span className={styles.questionToggle} aria-hidden="true">
                <Plus size={18} strokeWidth={1.5} />
              </span>
            </summary>
            <div className={styles.answerContent}>
              <p>{item.answer}</p>
              {item.links && (
                <div className={styles.answerLinks}>
                  {item.links.map((link) => (
                    <Link key={link.href} href={link.href}>
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
