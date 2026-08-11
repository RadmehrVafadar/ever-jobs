import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { AdminAuth } from "../auth/admin-auth.decorator";
import {
  OperatorOverview,
  OperatorOverviewService,
} from "./operator-overview.service";

@ApiTags("Operator")
@ApiSecurity("api-key")
@AdminAuth()
@Controller("api/operator")
export class OperatorOverviewController {
  constructor(private readonly overview: OperatorOverviewService) {}

  @Get("overview")
  @ApiOperation({
    summary: "Get the local operator health and activity overview",
  })
  getOverview(): Promise<OperatorOverview> {
    return this.overview.getOverview();
  }
}
