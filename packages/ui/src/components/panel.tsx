import type { PropsWithChildren, ReactNode } from "react";

interface PanelProps extends PropsWithChildren {
    eyebrow?: string;
    title?: string;
    footer?: ReactNode;
    className?: string;
}

export function Panel({ eyebrow, title, footer, className, children }: PanelProps) {
    return (
        <section className={["ui-panel", className].filter(Boolean).join(" ")}>
            {(eyebrow || title) && (
                <header className="ui-panel__header">
                    {eyebrow ? <span className="ui-panel__eyebrow">{eyebrow}</span> : null}
                    {title ? <h3 className="ui-panel__title">{title}</h3> : null}
                </header>
            )}
            <div className="ui-panel__body">{children}</div>
            {footer ? <footer className="ui-panel__footer">{footer}</footer> : null}
        </section>
    );
}
