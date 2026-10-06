import { useId } from 'react';

export default function ModuleHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  action,
  status,
  accent = 'rancho',
  variant = 'default',
  headingLevel = 'h1',
  className = '',
  children,
}) {
  const generatedId = useId().replace(/:/g, '');
  const titleId = `module-header-${generatedId}`;
  const Heading = headingLevel;

  return (
    <section
      className={`module-header module-header-${variant} accent-${accent} ${className}`.trim()}
      aria-labelledby={titleId}
    >
      <div className="module-header-main">
        {Icon && <span className="module-header-icon" aria-hidden="true"><Icon /></span>}
        <div className="module-header-copy">
          {eyebrow && <span className="module-header-eyebrow">{eyebrow}</span>}
          <Heading id={titleId}>{title}</Heading>
          {description && <p>{description}</p>}
        </div>
      </div>
      {(status || action) && (
        <div className="module-header-side">
          {status && <div className="module-header-status">{status}</div>}
          {action && <div className="module-header-action">{action}</div>}
        </div>
      )}
      {children && <div className="module-header-extra">{children}</div>}
    </section>
  );
}
