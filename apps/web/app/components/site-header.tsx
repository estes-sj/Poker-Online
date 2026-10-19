import Link from "next/link";

import { getBrandName } from "../lib/brand";

type SiteSection = "home" | "rooms" | "clubs" | "admin";

const NAV_ITEMS: Array<{ href: string; label: string; section: SiteSection }> = [
    { href: "/rooms", label: "Tables", section: "rooms" },
    { href: "/clubs", label: "Clubs", section: "clubs" },
];

export function SiteHeader({ current }: { current: SiteSection }) {
    const brandName = getBrandName();

    return (
        <header className="site-header">
            <div className="site-header__inner">
                <Link className="site-brand" href="/">
                    <img className="site-brand__mark" src="/poker.svg" alt="" />
                    <span className="site-brand__name">{brandName}</span>
                </Link>
                <nav className="site-nav" aria-label="Primary">
                    {NAV_ITEMS.map((item) => (
                        <Link
                            key={item.href}
                            className={item.section === current ? "site-nav__link site-nav__link--active" : "site-nav__link"}
                            href={item.href}
                            aria-current={item.section === current ? "page" : undefined}
                        >
                            {item.label}
                        </Link>
                    ))}
                    <Link className="site-nav__link" href="/rooms/sample-table">
                        Sample table
                    </Link>
                </nav>
            </div>
        </header>
    );
}

export function PageHeader({
    title,
    description,
    actions,
    meta,
}: {
    title: string;
    description?: React.ReactNode;
    actions?: React.ReactNode;
    meta?: React.ReactNode;
}) {
    return (
        <div className="page-header">
            <div className="page-header__text">
                {meta ? <div className="page-header__meta">{meta}</div> : null}
                <h1>{title}</h1>
                {description ? <p>{description}</p> : null}
            </div>
            {actions ? <div className="page-header__actions">{actions}</div> : null}
        </div>
    );
}
