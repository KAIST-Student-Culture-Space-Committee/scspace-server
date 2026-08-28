import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { LotteryPerformanceService } from "./lottery.performance.service";
import { AdminGuard, DelegatorGuard } from "@scspace-server/feature/auth/jwt/jwt.guard";
import { ILotteryInfo, ILotteryInfoCreate, ILotteryInfoUpdate } from "@scspace-depot/types/lottery/lottery.info.type";
import { IPerformanceLottery, IPerformanceLotteryCreate } from "@scspace-depot/types/lottery/lottery.performance.type";
import { ISuccessResponse } from "@scspace-depot/types/common";
import { AuthGuard } from "@nestjs/passport";
import { IUser } from "@scspace-depot/types/user";
import { UserUtils } from "@scspace-depot/utils/user.utils";
import { OrganizationPublicService } from "@scspace-server/feature/organization/organization.public.service";
import { OrganizationStatusEnum } from "@scspace-depot/enums/organization.enum";
import { LotteryPerformanceRepository } from "./lottery.performance.repository";

@Controller('lottery/performance')
export class LotteryPerformanceController {
    constructor(
        private readonly lotteryPerformanceService: LotteryPerformanceService,
        private readonly lotteryPerformanceRepository: LotteryPerformanceRepository,
        private readonly organizationPublicService: OrganizationPublicService,
    ) { }

    @Get("info")
    async getInfo(): Promise<ILotteryInfo[]> {
        // 모든 추첨 정보 조회 (시간 순 자동 정렬)
        return await this.lotteryPerformanceService.getAllPerformanceLotteryInfo();
    }

    @Get("info/active")
    async getActiveInfo(): Promise<ILotteryInfo[]> {
        // 현재 진행 중인 추첨 정보 조회 (시간 순 정렬)
        return await this.lotteryPerformanceService.getActivePerformanceLotteryInfo();
    }

    @Get("info/upcoming")
    async getUpcomingInfo(): Promise<ILotteryInfo[]> {
        // 예정된 추첨 정보 조회 (시간 순 정렬)
        return await this.lotteryPerformanceService.getUpcomingPerformanceLotteryInfo();
    }

    @UseGuards(AdminGuard)
    @Post("info")
    async postInfo(
        @Body() lotteryInfo: ILotteryInfoCreate
    ): Promise<ILotteryInfo> {
        // 새 추첨 정보 생성 (시간 겹침 검증 + 자동 정렬)
        return await this.lotteryPerformanceService.postPerformanceLotteryInfo({ lotteryInfo });
    }

    @UseGuards(AdminGuard)
    @Put("info/:id")
    async updateInfo(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateLotteryInfo: ILotteryInfoUpdate
    ): Promise<ILotteryInfo> {
        // 추첨 정보 업데이트 (시간 겹침 검증 + 자동 정렬)
        return await this.lotteryPerformanceService.updatePerformanceLotteryInfo({
            id,
            updateLotteryInfo
        });
    }

    @UseGuards(AdminGuard)
    @Delete("info/:id")
    async deleteInfo(
        @Param('id', ParseIntPipe) id: number
    ): Promise<ISuccessResponse> {
        // 추첨 정보 삭제
        return {
            success: await this.lotteryPerformanceService.deletePerformanceLotteryInfo(id)
        };
    }

    @Get()
    async getPerformanceLotteryByOrganization(
        @Query('organizationId', ParseIntPipe) organizationId: number,
        @Query('spaceId', ParseIntPipe) spaceId: number,
        @Query('infoId', ParseIntPipe) infoId: number
    ): Promise<IPerformanceLottery[]> {
        // Implementation for fetching performance lottery by organization
        return await this.lotteryPerformanceService.getPerformanceLotteryByOrganization({
            organizationId,
            spaceId,
            infoId
        });
    }

    @Get("date")
    async getPerformanceLotteryByDate(
        @Query('date', ParseIntPipe) date: number,
        @Query('spaceId', ParseIntPipe) spaceId: number,
        @Query('infoId', ParseIntPipe) infoId: number
    ): Promise<IPerformanceLottery[]> {
        // Implementation for fetching performance lottery by date
        return await this.lotteryPerformanceService.getPerformanceLotteryByDate({
            date,
            spaceId,
            infoId
        });
    }

    @Get("dateslot-counts")
    async getDateSlotCounts(
        @Query('spaceId', ParseIntPipe) spaceId: number,
        @Query('infoId', ParseIntPipe) infoId: number
    ): Promise<{ date: number; count: [number, number, number] }[]> {
        // 모든 날짜에 대해 신청한 조직 수를 priority별로 조회
        return await this.lotteryPerformanceService.getPerformanceLotteryDateSlotCounts({ spaceId, infoId });
    }

    @Get("drawn")
    async getDrawnPerformanceLottery(
        @Query('spaceId', ParseIntPipe) spaceId: number,
        @Query('infoId', ParseIntPipe) infoId: number
    ): Promise<IPerformanceLottery[]> {
        // 당첨된 공연 추첨 조회
        return await this.lotteryPerformanceService.getDrawnPerformanceLottery({ spaceId, infoId });
    }

    @UseGuards(DelegatorGuard)
    @Post()
    async postPerformanceLottery(
        @Body() lottery: IPerformanceLotteryCreate
    ): Promise<IPerformanceLottery> {
        return await this.lotteryPerformanceService.postPerformanceLottery({
            lottery: {
                infoId: lottery.infoId,
                organizationId: lottery.organizationId,
                spaceId: lottery.spaceId,
                priority: lottery.priority,
                date: lottery.date,
            },
        });
    }

    @UseGuards(AuthGuard("jwt"))
    @Delete(":id")
    async deletePerformanceLottery(
        @Param('id', ParseIntPipe) id: number,
        @Req() request: { user: IUser },
    ): Promise<ISuccessResponse> {
        await this.assertCanManageLottery(id, request.user);
        return {
            success: await this.lotteryPerformanceService.deletePerformanceLottery(id, false)
        }
    }

    @UseGuards(AdminGuard)
    @Post("draw")
    async drawPerformanceLottery(): Promise<ISuccessResponse> {
        return { success: await this.lotteryPerformanceService.drawing() };
    }

    @UseGuards(AdminGuard)
    @Post("apply")
    async applyPerformanceLottery(): Promise<ISuccessResponse> {
        // 공연 추첨 결과 적용
        await this.lotteryPerformanceService.applyPerformanceLottery();
        return { success: true };
    }

    private async assertCanManageLottery(id: number, user: IUser): Promise<void> {
        if (UserUtils.isManager(user.type)) {
            return;
        }

        const [lottery] = await this.lotteryPerformanceRepository.fetch({ id });
        if (!lottery) {
            throw new NotFoundException('Performance lottery not found');
        }

        const organization = await this.organizationPublicService.fetchById(lottery.organizationId);
        if (
            !organization ||
            organization.status !== OrganizationStatusEnum.VERIFIED ||
            organization.delegatorId !== user.id
        ) {
            throw new ForbiddenException('Only the verified organization delegator can delete this lottery');
        }

        const openLotteries = await this.lotteryPerformanceService.getActivePerformanceLotteryInfo();
        if (!openLotteries.some(({ id: infoId }) => infoId === lottery.infoId)) {
            throw new ForbiddenException('Lottery applications can only be deleted during the application period');
        }
    }
}
