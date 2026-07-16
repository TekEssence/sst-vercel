export namespace Route {
  type ComponentProps = { loaderData: { projects: import("~/lib/api").Project[] } };
  type ClientLoaderArgs = { params: Record<string, string> };
}
