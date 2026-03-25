import { style } from '@vanilla-extract/css';

export const UserLink = style({
  color: 'inherit',
  textDecoration: 'none',
  selectors: {
    '&:hover, &:focus-visible': {
      textDecoration: 'underline',
    },
  },
});
