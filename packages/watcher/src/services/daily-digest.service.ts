import { Inject, Injectable } from '@nestjs/common';
import { WatchRepository } from '../interfaces/watch.types';
@Injectable()
export class DailyDigestService { constructor(@Inject('WatchRepository') private readonly repo: WatchRepository) {} async selectDigestMatches(watchId: string, digestScore: number, minimumScore: number) { return this.repo.listDigestMatches(watchId, digestScore, minimumScore); } }
