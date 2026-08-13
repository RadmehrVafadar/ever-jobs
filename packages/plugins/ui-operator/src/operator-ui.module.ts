import { Module } from "@nestjs/common";
import { UI_PLUGIN_TOKEN } from "@ever-jobs/plugin";
import { OperatorUiPlugin } from "./operator-ui.plugin";

@Module({
  providers: [
    OperatorUiPlugin,
    { provide: UI_PLUGIN_TOKEN, useExisting: OperatorUiPlugin },
  ],
  exports: [OperatorUiPlugin, UI_PLUGIN_TOKEN],
})
export class OperatorUiModule {}
