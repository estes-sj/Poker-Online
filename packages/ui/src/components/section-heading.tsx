import type { PropsWithChildren } from "react";

interface SectionHeadingProps extends PropsWithChildren {
    eyebrow: string;
    title: string;
}

export function SectionHeading({ eyebrow, title, children }: SectionHeadingProps) {
    return (
        <div className="section-heading">
            <span className="section-heading__eyebrow">{eyebrow}</span>
            <h2 className="section-heading__title">{title}</h2>
            {children ? <p className="section-heading__copy">{children}</p> : null}
        </div>
    );
}
