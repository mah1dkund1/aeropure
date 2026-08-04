package com.aeropure.aeropure_backend.service;

import com.aeropure.aeropure_backend.model.Command;
import com.aeropure.aeropure_backend.repository.CommandRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Optional;


@Service


public class CommandService {
    private final CommandRepository commandRepository;

    public CommandService(CommandRepository commandRepository){
        this.commandRepository = commandRepository;

    }

    // POST send command

    public Command queueCommand(String deviceId, String supplyStatus) {
        Optional<Command> existingOpt = commandRepository.findFirstByDeviceIdOrderByIdDesc(deviceId);

        if (existingOpt.isPresent()) {
            Command existing = existingOpt.get();

            if ("pending".equals(existing.getStatus()) || "sent".equals(existing.getStatus())) {
                return existing;
            }

            existing.setSupplyStatus(supplyStatus);
            existing.setStatus("pending");
            existing.setUpdatedAt(LocalDateTime.now());
            return commandRepository.save(existing);

        }

        Command command = new Command();
        command.setDeviceId(deviceId);
        command.setSupplyStatus(supplyStatus);
        command.setStatus("pending");
        command.setCreatedAt(LocalDateTime.now());
        command.setUpdatedAt(LocalDateTime.now());

        return commandRepository.save(command);

    }

    // GET poll_command_status
    public Command getLatestCommand(String deviceId) {
        return commandRepository.findFirstByDeviceIdOrderByIdDesc(deviceId).orElse(null);
    }

    //used by tcp server , check if a device has a pending command waiting

    public Optional<Command> getPendingCommand(String deviceId) {

        return commandRepository.findFirstByDeviceIdOrderByIdDesc(deviceId).filter(cmd -> "pending".equals(cmd.getStatus()));
    }

    //used later by tcp server: mark a command as sent to device
    public void markSent(Command command)
    {
        command.setStatus("sent");
        command.setUpdatedAt(LocalDateTime.now());
        commandRepository.save(command);

    }

    public void evaluateOutcome(String deviceId, String actualSupplyStatus, String supplyFault ){
commandRepository.findFirstByDeviceIdOrderByIdDesc(deviceId).ifPresent(command -> {
    if(!"sent".equals(command.getStatus())){
        return;
    }
    if(command.getSupplyStatus().equals(actualSupplyStatus)) {
        command.setStatus("completed");
    }
    else {
        command.setStatus("error");
        command.setSupplyStatus((actualSupplyStatus));
        command.setSupplyFault(supplyFault);

    }

    command.setUpdatedAt(LocalDateTime.now());
    commandRepository.save(command);
    });


    }















}
