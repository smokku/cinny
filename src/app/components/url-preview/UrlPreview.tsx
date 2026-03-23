import React from 'react';
import classNames from 'classnames';
import { Box, as } from 'folds';
import * as css from './UrlPreview.css';
import { UrlPreviewSize } from '../../state/settings';

export const URL_PREVIEW_IMG_MAX_HEIGHT = 300;

export const UrlPreview = as<'div'>(({ className, ...props }, ref) => (
  <Box shrink="No" className={classNames(css.UrlPreview, className)} {...props} ref={ref} />
));

export const UrlPreviewImg = as<
  'img',
  { className?: string; alt: string; urlPreviewSize: UrlPreviewSize }
>(({ className, alt, urlPreviewSize, ...props }, ref) => {
  const isBig = urlPreviewSize !== UrlPreviewSize.Compact;
  const objectFit = urlPreviewSize === UrlPreviewSize.Cover ? 'cover' : 'contain';
  const bigUrlPreviewProps: Partial<React.ComponentProps<typeof Box>> | undefined = isBig
    ? {
        style: {
          width: '100%',
          height: '100%',
          maxHeight: `${URL_PREVIEW_IMG_MAX_HEIGHT}px`,
          objectFit,
          objectPosition: 'center',
          justifyContent: 'center',
        },
      }
    : undefined;

  return (
    <img
      {...bigUrlPreviewProps}
      className={classNames(css.UrlPreviewImg, className)}
      alt={alt}
      {...props}
      ref={ref}
    />
  );
});

export const UrlPreviewContent = as<'div', Pick<React.ComponentProps<typeof Box>, 'gap'>>(
  ({ className, gap = '100', ...props }, ref) => (
    <Box
      grow="Yes"
      direction="Column"
      gap={gap}
      className={classNames(css.UrlPreviewContent, className)}
      {...props}
      ref={ref}
    />
  )
);

export const UrlPreviewDescription = as<'span'>(({ className, ...props }, ref) => (
  <span className={classNames(css.UrlPreviewDescription, className)} {...props} ref={ref} />
));
