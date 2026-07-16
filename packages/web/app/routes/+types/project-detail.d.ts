export namespace Route {
  type ComponentProps = { loaderData: any };
  type ClientLoaderArgs = { params: Record<string, string> };
  type ClientActionArgs = { params: Record<string, string>; request: Request };
}
