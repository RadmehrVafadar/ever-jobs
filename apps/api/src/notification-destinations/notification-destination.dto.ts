import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsUUID, MaxLength } from "class-validator";

export class SetDiscordDestinationDto {
  @ApiProperty({
    format: "password",
    description:
      "Discord webhook URL. Accepted once and never returned by the API.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_048)
  webhookUrl!: string;
}

export class TestDiscordDestinationDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  watchId!: string;
}
