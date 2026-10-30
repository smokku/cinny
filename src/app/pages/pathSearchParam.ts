import { _RoomSearchParams, DirectCreateSearchParams, MatrixLinkSearchParams } from './paths';

type SearchParamsGetter<T> = (searchParams: URLSearchParams) => T;

export const getRoomSearchParams: SearchParamsGetter<_RoomSearchParams> = (searchParams) => ({
  viaServers: searchParams.get('viaServers') ?? undefined,
});

export const getDirectCreateSearchParams: SearchParamsGetter<DirectCreateSearchParams> = (
  searchParams
) => ({
  userId: searchParams.get('userId') ?? undefined,
});

export const getMatrixLinkSearchParams: SearchParamsGetter<MatrixLinkSearchParams> = (
  searchParams
) => ({
  uri: searchParams.get('uri') ?? undefined,
});
