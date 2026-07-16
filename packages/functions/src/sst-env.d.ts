import "sst";

declare module "sst" {
  export interface Resource {
    ProjectsTable: { name: string; arn: string };
    DeploymentsTable: { name: string; arn: string };
    EventBus: { name: string; arn: string };
  }
}
