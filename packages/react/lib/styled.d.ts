/**
 * Type definitions. Without runtime implementation.
 * Bundler plugin required.
 * ```ts
 * type styled = { [T in keyof JSX.IntrinsicElements]: <const R>(rule: R) => StyledComponent<T, R> };
 * ```
 */
import type {
  ComponentPropsWithRef,
  JSX,
  JSXElementConstructor,
  ReactElement,
} from 'react';
import type {
  AtomicClassNameFor,
  AtomicStyle,
  CSSProperties,
  Style,
} from '@plumeria/core';

type NestedKey = `:${string}` | `[${string}` | `@${string}`;

type Dynamic<T, P> = {
  [K in keyof T]: K extends NestedKey
    ? Dynamic<T[K], P>
    : T[K] | ((props: P) => T[K]);
};

export type StyledRule<P> = Dynamic<CSSProperties, P>;

type Reads<R> =
  R extends AtomicClassNameFor<string, infer V>
    ? Reads<V>
    : R extends (props: infer A) => any
      ? A
      : R extends object
        ? { [K in keyof R]: Reads<R[K]> }[keyof R]
        : never;

type Intersect<U> = (U extends any ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;

export type StyledPropsOf<R> = [Reads<R>] extends [never]
  ? {}
  : Intersect<Reads<R>>;

export type StyledTarget =
  | keyof JSX.IntrinsicElements
  | JSXElementConstructor<any>;

export type StyledProps<T extends StyledTarget, P> = P &
  Omit<ComponentPropsWithRef<T>, keyof P | 'sx'> & {
    sx?: Style;
  };

declare const styledBrand: unique symbol;

type Branded = { readonly [styledBrand]: unknown };

export type StyledComponent<T extends StyledTarget, R> = ((
  props: StyledProps<T, StyledPropsOf<R>>,
) => ReactElement) & {
  readonly [styledBrand]: R;
};

export type StyledFactory<T extends StyledTarget> = {
  <const R extends StyledRule<never>>(
    rule: R,
  ): StyledComponent<T, AtomicStyle<R>>;
  new (rule: never): never;
};

export type styled = {
  <C extends JSXElementConstructor<any> & Branded>(
    component: C,
  ): StyledFactory<C>;
} & {
  [T in keyof JSX.IntrinsicElements]: StyledFactory<T>;
};

export const styled: styled;
